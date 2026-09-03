use std::{io, path::Path, path::PathBuf, sync::Mutex};

use rusqlite::{params, types::Type, Connection, OptionalExtension, Result};

use crate::releases::{
    ArticleBinding, BatchState, BindingOutputKind, BindingRevision, BindingRevisionState,
    BindingState, BindingTransition, ContentHash, OperationKind, ReleaseOperation,
};
use crate::tracking::snapshot::Snapshot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerBatch {
    pub id: String,
    pub scope_id: String,
    pub target_id: String,
    pub change_ids: Vec<String>,
    pub scope_revision: i64,
    pub target_sequence_before: i64,
    pub target_head_before: String,
    pub state: BatchState,
    pub created_at: String,
    pub previewed_at: Option<String>,
    pub commit_sha: Option<String>,
    pub published_at: Option<String>,
    pub rollback_commit_sha: Option<String>,
    pub rolled_back_at: Option<String>,
    pub failure_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerOperation {
    pub id: String,
    pub binding_id: String,
    pub ordinal: i64,
    pub operation: ReleaseOperation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceTransition {
    pub source_identity: String,
    pub before: Option<Snapshot>,
    pub after: Option<Snapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseConflict {
    pub id: String,
    pub target_path: PathBuf,
    pub code: String,
    pub expected_hash: Option<ContentHash>,
    pub actual_hash: Option<ContentHash>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewRecord {
    pub batch: LedgerBatch,
    pub bindings: Vec<ArticleBinding>,
    pub revisions: Vec<BindingRevision>,
    pub operations: Vec<LedgerOperation>,
    pub binding_transitions: Vec<BindingTransition>,
    pub source_transitions: Vec<SourceTransition>,
}

pub struct LedgerRepository {
    connection: Mutex<Connection>,
}

impl LedgerRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn create_preview(&self, preview: &PreviewRecord) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let transaction = connection.transaction()?;
        ensure_preview_state(&preview.batch)?;
        let acquired = transaction.execute(
            "INSERT INTO target_revisions (target_id, sequence, head_sha, active_batch_id)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(target_id) DO UPDATE SET active_batch_id = excluded.active_batch_id
             WHERE target_revisions.active_batch_id IS NULL
               AND target_revisions.sequence = excluded.sequence
               AND target_revisions.head_sha = excluded.head_sha",
            params![
                preview.batch.target_id,
                preview.batch.target_sequence_before,
                preview.batch.target_head_before,
                preview.batch.id
            ],
        )?;
        if acquired != 1 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        transaction.execute(
            "INSERT INTO release_batches (batch_id, scope_id, target_id, change_ids, scope_revision, target_sequence_before, target_head_before, state, created_at, previewed_at, commit_sha, published_at, rollback_commit_sha, rolled_back_at, failure_code)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL, NULL, NULL, NULL)",
            params![preview.batch.id, preview.batch.scope_id, preview.batch.target_id, serde_json::to_string(&preview.batch.change_ids).unwrap(), preview.batch.scope_revision, preview.batch.target_sequence_before, preview.batch.target_head_before, batch_state_name(preview.batch.state), preview.batch.created_at, preview.batch.previewed_at],
        )?;
        for binding in &preview.bindings {
            transaction.execute(
                "INSERT INTO article_bindings (binding_id, target_id, scope_id, source_identity, state, current_revision_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(binding_id) DO NOTHING",
                params![binding.id, binding.target_id, binding.scope_id, binding.source_identity, binding_state_name(binding.state), binding.current_revision],
            )?;
        }
        for revision in &preview.revisions {
            transaction.execute(
                "INSERT INTO binding_revisions (revision_id, binding_id, revision_number, state) VALUES (?1, ?2, ?3, ?4)",
                params![revision.id, revision.binding_id, revision.revision_number, binding_revision_state_name(revision.state)],
            )?;
            for output in &revision.outputs {
                transaction.execute(
                    "INSERT INTO binding_outputs (revision_id, target_path, content_hash, git_blob_sha, output_kind) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![revision.id, output.target_path.to_string_lossy(), output.content_hash.0, output.git_blob_sha, binding_output_kind_name(output.kind)],
                )?;
            }
        }
        for operation in &preview.operations {
            let item = &operation.operation;
            transaction.execute(
                "INSERT INTO release_operations (operation_id, batch_id, ordinal, binding_id, target_path, operation_kind, before_hash, after_hash, before_blob_sha, after_blob_sha)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![operation.id, preview.batch.id, operation.ordinal, operation.binding_id, item.target_path.to_string_lossy(), operation_kind_name(item.operation_kind), item.before_hash.as_ref().map(|hash| &hash.0), item.after_hash.as_ref().map(|hash| &hash.0), item.before_blob_sha, item.after_blob_sha],
            )?;
        }
        for transition in &preview.binding_transitions {
            transaction.execute(
                "INSERT INTO release_binding_transitions (batch_id, binding_id, before_revision_id, after_revision_id) VALUES (?1, ?2, ?3, ?4)",
                params![preview.batch.id, transition.binding_id, transition.before_revision_id, transition.after_revision_id],
            )?;
        }
        for transition in &preview.source_transitions {
            transaction.execute(
                "INSERT INTO release_source_transitions (batch_id, source_identity, before_source_path, before_title, before_fingerprint, before_observed_at, after_source_path, after_title, after_fingerprint, after_observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![preview.batch.id, transition.source_identity, transition.before.as_ref().map(|snapshot| &snapshot.source_path), transition.before.as_ref().and_then(|snapshot| snapshot.title.as_ref()), transition.before.as_ref().map(|snapshot| &snapshot.fingerprint), transition.before.as_ref().map(|snapshot| &snapshot.observed_at), transition.after.as_ref().map(|snapshot| &snapshot.source_path), transition.after.as_ref().and_then(|snapshot| snapshot.title.as_ref()), transition.after.as_ref().map(|snapshot| &snapshot.fingerprint), transition.after.as_ref().map(|snapshot| &snapshot.observed_at)],
            )?;
        }
        transaction.commit()
    }

    pub fn load_batch(&self, batch_id: &str) -> Result<Option<LedgerBatch>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let batch = connection
            .query_row("SELECT batch_id, scope_id, target_id, change_ids, scope_revision, target_sequence_before, target_head_before, state, created_at, previewed_at, commit_sha, published_at, rollback_commit_sha, rolled_back_at, failure_code FROM release_batches WHERE batch_id = ?1", [batch_id], ledger_batch_row)
            .optional()?;
        if batch.is_some() {
            return Ok(batch);
        }
        connection.query_row(
            "SELECT batch_id, scope_id, target_id, commit_sha, change_ids, published_at, rollback_commit_sha, rolled_back_at FROM publications WHERE batch_id = ?1",
            [batch_id],
            |row| Ok(LedgerBatch { id: row.get(0)?, scope_id: row.get(1)?, target_id: row.get(2)?, change_ids: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or_default(), scope_revision: 0, target_sequence_before: 0, target_head_before: String::new(), state: BatchState::Legacy, created_at: row.get::<_, Option<String>>(5)?.unwrap_or_default(), previewed_at: None, commit_sha: Some(row.get(3)?), published_at: row.get(5)?, rollback_commit_sha: row.get(6)?, rolled_back_at: row.get(7)?, failure_code: None }),
        ).optional()
    }

    pub fn load_operations(&self, batch_id: &str) -> Result<Vec<LedgerOperation>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let mut statement = connection.prepare("SELECT operation_id, binding_id, ordinal, target_path, operation_kind, before_hash, after_hash, before_blob_sha, after_blob_sha FROM release_operations WHERE batch_id = ?1 ORDER BY ordinal")?;
        let operations = statement
            .query_map([batch_id], operation_row)?
            .collect::<Result<Vec<_>>>()?;
        Ok(operations)
    }

    pub fn load_source_transitions(&self, batch_id: &str) -> Result<Vec<SourceTransition>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let mut statement = connection.prepare("SELECT source_identity, before_source_path, before_title, before_fingerprint, before_observed_at, after_source_path, after_title, after_fingerprint, after_observed_at FROM release_source_transitions WHERE batch_id = ?1 ORDER BY source_identity")?;
        let transitions = statement
            .query_map([batch_id], |row| {
                let source_identity: String = row.get(0)?;
                let before_fingerprint: Option<String> = row.get(3)?;
                let after_fingerprint: Option<String> = row.get(7)?;
                let before_source_path: Option<String> = row.get(1)?;
                let before_title: Option<String> = row.get(2)?;
                let before_observed_at: Option<String> = row.get(4)?;
                let after_source_path: Option<String> = row.get(5)?;
                let after_title: Option<String> = row.get(6)?;
                let after_observed_at: Option<String> = row.get(8)?;
                let before = snapshot_from_transition_columns(
                    source_identity.clone(),
                    before_source_path,
                    before_title,
                    before_fingerprint,
                    before_observed_at,
                )?;
                let after = snapshot_from_transition_columns(
                    source_identity.clone(),
                    after_source_path,
                    after_title,
                    after_fingerprint,
                    after_observed_at,
                )?;
                Ok(SourceTransition {
                    source_identity: source_identity.clone(),
                    before,
                    after,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(transitions)
    }

    pub fn target_revision(&self, target_id: &str, head_sha: &str) -> Result<(i64, String)> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection.execute(
            "INSERT INTO target_revisions (target_id, sequence, head_sha, active_batch_id)
             VALUES (?1, 0, ?2, NULL) ON CONFLICT(target_id) DO NOTHING",
            params![target_id, head_sha],
        )?;
        connection.query_row(
            "SELECT sequence, head_sha FROM target_revisions WHERE target_id = ?1",
            [target_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    pub fn observe_target_head(&self, target_id: &str, head_sha: &str) -> Result<(i64, String)> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection.execute(
            "UPDATE target_revisions SET head_sha = ?2 WHERE target_id = ?1 AND active_batch_id IS NULL",
            params![target_id, head_sha],
        )?;
        connection.query_row(
            "SELECT sequence, head_sha FROM target_revisions WHERE target_id = ?1",
            [target_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    pub fn binding_for_source(
        &self,
        target_id: &str,
        source_identity: &str,
    ) -> Result<Option<ArticleBinding>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection
            .query_row(
                "SELECT binding_id, target_id, scope_id, source_identity, state, current_revision_id FROM article_bindings WHERE target_id = ?1 AND source_identity = ?2",
                params![target_id, source_identity],
                |row| Ok(ArticleBinding {
                    id: row.get(0)?, target_id: row.get(1)?, scope_id: row.get(2)?, source_identity: row.get(3)?, state: binding_state_from(&row.get::<_, String>(4)?)?, current_revision: row.get(5)?,
                }),
            )
            .optional()
    }

    pub fn next_revision_number(&self, binding_id: &str) -> Result<i64> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection.query_row(
            "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM binding_revisions WHERE binding_id = ?1",
            [binding_id],
            |row| row.get(0),
        )
    }

    pub fn revision_outputs(
        &self,
        revision_id: &str,
    ) -> Result<Vec<crate::releases::BindingOutput>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let mut statement = connection.prepare(
            "SELECT target_path, content_hash, git_blob_sha, output_kind FROM binding_outputs WHERE revision_id = ?1 ORDER BY target_path",
        )?;
        let outputs = statement
            .query_map([revision_id], |row| {
                Ok(crate::releases::BindingOutput {
                    target_path: PathBuf::from(row.get::<_, String>(0)?),
                    content_hash: ContentHash(row.get(1)?),
                    git_blob_sha: row.get(2)?,
                    kind: binding_output_kind_from(&row.get::<_, String>(3)?)?,
                })
            })?
            .collect();
        outputs
    }

    pub fn output_owner(&self, target_id: &str, path: &Path) -> Result<Option<String>> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection
            .query_row(
                "SELECT bindings.binding_id
                 FROM article_bindings bindings
                 JOIN binding_outputs outputs ON outputs.revision_id = bindings.current_revision_id
                 WHERE bindings.target_id = ?1 AND outputs.target_path = ?2",
                params![target_id, path.to_string_lossy()],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn begin_publish(&self, batch_id: &str) -> Result<bool> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        Ok(connection.execute(
            "UPDATE release_batches SET state = 'committing' WHERE batch_id = ?1 AND state = 'previewed' AND EXISTS (SELECT 1 FROM target_revisions WHERE target_revisions.target_id = release_batches.target_id AND target_revisions.active_batch_id = release_batches.batch_id)",
            [batch_id],
        )? == 1)
    }

    pub fn mark_pending_push(&self, batch_id: &str, commit_sha: &str) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        if connection.execute("UPDATE release_batches SET state = 'pending_push', commit_sha = ?2 WHERE batch_id = ?1 AND state = 'committing'", params![batch_id, commit_sha])? != 1 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }

    pub fn begin_rollback(&self, batch_id: &str) -> Result<bool> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        Ok(connection.execute(
            "UPDATE release_batches SET state = 'rollback_prepared' WHERE batch_id = ?1 AND state = 'published' AND EXISTS (SELECT 1 FROM target_revisions WHERE target_revisions.target_id = release_batches.target_id AND target_revisions.active_batch_id = release_batches.batch_id)",
            [batch_id],
        )? == 1)
    }

    pub fn mark_rollback_pending(&self, batch_id: &str, commit_sha: &str) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        if connection.execute(
            "UPDATE release_batches SET state = 'rollback_pending', rollback_commit_sha = ?2 WHERE batch_id = ?1 AND state = 'rollback_prepared'",
            params![batch_id, commit_sha],
        )? != 1 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }

    pub fn acquire_target_mutation(&self, target_id: &str, batch_id: &str) -> Result<bool> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        Ok(connection.execute("UPDATE target_revisions SET active_batch_id = ?2 WHERE target_id = ?1 AND active_batch_id IS NULL", params![target_id, batch_id])? == 1)
    }

    pub fn finalize_publish(
        &self,
        batch_id: &str,
        remote_head: &str,
        published_at: &str,
    ) -> Result<()> {
        self.finalize(
            batch_id,
            BatchState::PendingPush,
            BatchState::Published,
            remote_head,
            published_at,
            false,
        )
    }

    pub fn finalize_rollback(
        &self,
        batch_id: &str,
        remote_head: &str,
        rolled_back_at: &str,
    ) -> Result<()> {
        self.finalize(
            batch_id,
            BatchState::RollbackPending,
            BatchState::RolledBack,
            remote_head,
            rolled_back_at,
            true,
        )
    }

    pub fn record_conflicts(&self, batch_id: &str, conflicts: &[ReleaseConflict]) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let transaction = connection.transaction()?;
        for conflict in conflicts {
            transaction.execute("INSERT INTO release_conflicts (conflict_id, batch_id, target_path, conflict_code, expected_hash, actual_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(batch_id, target_path, conflict_code) DO UPDATE SET expected_hash = excluded.expected_hash, actual_hash = excluded.actual_hash, created_at = excluded.created_at", params![conflict.id, batch_id, conflict.target_path.to_string_lossy(), conflict.code, conflict.expected_hash.as_ref().map(|hash| &hash.0), conflict.actual_hash.as_ref().map(|hash| &hash.0), conflict.created_at])?;
        }
        transaction.commit()
    }

    pub fn mark_recovery_required(&self, batch_id: &str, failure_code: &str) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        connection.execute("UPDATE release_batches SET state = 'recovery_required', failure_code = ?2 WHERE batch_id = ?1", params![batch_id, failure_code])?;
        Ok(())
    }

    fn finalize(
        &self,
        batch_id: &str,
        expected: BatchState,
        next: BatchState,
        remote_head: &str,
        at: &str,
        rollback: bool,
    ) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("ledger repository lock poisoned");
        let transaction = connection.transaction()?;
        let batch = transaction.query_row("SELECT batch_id, scope_id, target_id, change_ids, scope_revision, target_sequence_before, target_head_before, state, created_at, previewed_at, commit_sha, published_at, rollback_commit_sha, rolled_back_at, failure_code FROM release_batches WHERE batch_id = ?1", [batch_id], ledger_batch_row)?;
        if batch.state != expected && batch.state != next {
            return Err(rusqlite::Error::InvalidQuery);
        }
        if batch.state == expected {
            let changed = if rollback {
                transaction.execute("UPDATE release_batches SET state = 'rolled_back', rolled_back_at = ?2 WHERE batch_id = ?1 AND state = 'rollback_pending'", params![batch_id, at])?
            } else {
                transaction.execute("UPDATE release_batches SET state = 'published', published_at = ?2 WHERE batch_id = ?1 AND state = 'pending_push'", params![batch_id, at])?
            };
            if changed != 1 {
                return Err(rusqlite::Error::InvalidQuery);
            }
            let mut transitions = transaction.prepare("SELECT binding_id, before_revision_id, after_revision_id FROM release_binding_transitions WHERE batch_id = ?1")?;
            let rows = transitions
                .query_map([batch_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>>>()?;
            for (binding_id, before, after) in rows {
                let revision = if rollback { before } else { after };
                transaction.execute("UPDATE article_bindings SET current_revision_id = ?2, state = CASE WHEN ?2 IS NULL THEN 'deleted' ELSE (SELECT CASE state WHEN 'active' THEN 'active' ELSE 'deleted' END FROM binding_revisions WHERE revision_id = ?2) END WHERE binding_id = ?1", params![binding_id, revision])?;
            }
            transaction.execute("UPDATE target_revisions SET sequence = sequence + 1, head_sha = ?2, active_batch_id = NULL WHERE target_id = ?1 AND active_batch_id = ?3", params![batch.target_id, remote_head, batch_id])?;
        }
        transaction.commit()
    }
}

fn snapshot_from_transition_columns(
    source_identity: String,
    source_path: Option<String>,
    title: Option<String>,
    fingerprint: Option<String>,
    observed_at: Option<String>,
) -> Result<Option<Snapshot>> {
    match (source_path, fingerprint, observed_at) {
        (None, None, None) => Ok(None),
        (Some(source_path), Some(fingerprint), Some(observed_at)) => Ok(Some(Snapshot {
            scope_id: String::new(),
            source_identity,
            source_path,
            title,
            fingerprint,
            observed_at,
        })),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Release source transition contains an incomplete snapshot",
            )
            .into(),
        )),
    }
}

fn ensure_preview_state(batch: &LedgerBatch) -> Result<()> {
    if matches!(batch.state, BatchState::Draft | BatchState::Previewed) {
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}

fn ledger_batch_row(row: &rusqlite::Row<'_>) -> Result<LedgerBatch> {
    Ok(LedgerBatch {
        id: row.get(0)?,
        scope_id: row.get(1)?,
        target_id: row.get(2)?,
        change_ids: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
        scope_revision: row.get(4)?,
        target_sequence_before: row.get(5)?,
        target_head_before: row.get(6)?,
        state: batch_state_from(&row.get::<_, String>(7)?)?,
        created_at: row.get(8)?,
        previewed_at: row.get(9)?,
        commit_sha: row.get(10)?,
        published_at: row.get(11)?,
        rollback_commit_sha: row.get(12)?,
        rolled_back_at: row.get(13)?,
        failure_code: row.get(14)?,
    })
}

fn operation_row(row: &rusqlite::Row<'_>) -> Result<LedgerOperation> {
    Ok(LedgerOperation {
        id: row.get(0)?,
        binding_id: row.get(1)?,
        ordinal: row.get(2)?,
        operation: ReleaseOperation {
            target_path: PathBuf::from(row.get::<_, String>(3)?),
            operation_kind: operation_kind_from(&row.get::<_, String>(4)?)?,
            before_hash: optional_hash(row, 5)?,
            after_hash: optional_hash(row, 6)?,
            before_blob_sha: row.get(7)?,
            after_blob_sha: row.get(8)?,
        },
    })
}

fn optional_hash(row: &rusqlite::Row<'_>, index: usize) -> Result<Option<ContentHash>> {
    Ok(row.get::<_, Option<String>>(index)?.map(ContentHash))
}
fn batch_state_name(value: BatchState) -> &'static str {
    match value {
        BatchState::Draft => "draft",
        BatchState::Previewed => "previewed",
        BatchState::Committing => "committing",
        BatchState::PendingPush => "pending_push",
        BatchState::Published => "published",
        BatchState::RollbackPrepared => "rollback_prepared",
        BatchState::RollbackPending => "rollback_pending",
        BatchState::RolledBack => "rolled_back",
        BatchState::Invalidated => "invalidated",
        BatchState::RecoveryRequired => "recovery_required",
        BatchState::Legacy => "legacy",
    }
}
fn batch_state_from(value: &str) -> Result<BatchState> {
    match value {
        "draft" => Ok(BatchState::Draft),
        "previewed" => Ok(BatchState::Previewed),
        "committing" => Ok(BatchState::Committing),
        "pending_push" => Ok(BatchState::PendingPush),
        "published" => Ok(BatchState::Published),
        "rollback_prepared" => Ok(BatchState::RollbackPrepared),
        "rollback_pending" => Ok(BatchState::RollbackPending),
        "rolled_back" => Ok(BatchState::RolledBack),
        "invalidated" => Ok(BatchState::Invalidated),
        "recovery_required" => Ok(BatchState::RecoveryRequired),
        "legacy" => Ok(BatchState::Legacy),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            6,
            Type::Text,
            format!("Unknown release batch state: {value}").into(),
        )),
    }
}
fn operation_kind_name(value: OperationKind) -> &'static str {
    match value {
        OperationKind::Write => "write",
        OperationKind::Delete => "delete",
    }
}
fn operation_kind_from(value: &str) -> Result<OperationKind> {
    match value {
        "write" => Ok(OperationKind::Write),
        "delete" => Ok(OperationKind::Delete),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            4,
            Type::Text,
            format!("Unknown release operation kind: {value}").into(),
        )),
    }
}
fn binding_state_name(value: BindingState) -> &'static str {
    match value {
        BindingState::Active => "active",
        BindingState::Deleted => "deleted",
        BindingState::NeedsReconciliation => "needs_reconciliation",
        BindingState::RecoveryRequired => "recovery_required",
    }
}

fn binding_state_from(value: &str) -> Result<BindingState> {
    match value {
        "active" => Ok(BindingState::Active),
        "deleted" => Ok(BindingState::Deleted),
        "needs_reconciliation" => Ok(BindingState::NeedsReconciliation),
        "recovery_required" => Ok(BindingState::RecoveryRequired),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            4,
            Type::Text,
            format!("Unknown binding state: {value}").into(),
        )),
    }
}
fn binding_revision_state_name(value: BindingRevisionState) -> &'static str {
    match value {
        BindingRevisionState::Active => "active",
        BindingRevisionState::Deleted => "deleted",
    }
}
fn binding_output_kind_name(value: BindingOutputKind) -> &'static str {
    match value {
        BindingOutputKind::Article => "article",
        BindingOutputKind::Resource => "resource",
    }
}

fn binding_output_kind_from(value: &str) -> Result<BindingOutputKind> {
    match value {
        "article" => Ok(BindingOutputKind::Article),
        "resource" => Ok(BindingOutputKind::Resource),
        _ => Err(rusqlite::Error::FromSqlConversionFailure(
            3,
            Type::Text,
            format!("Unknown binding output kind: {value}").into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::releases::BindingOutput;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> PathBuf {
        std::env::temp_dir().join(format!(
            "easyblog-ledger-{}.db",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn create_scope_and_target(path: &Path) {
        let connection = Connection::open(path).unwrap();
        crate::storage::database::initialize(&connection).unwrap();
        connection.execute("INSERT INTO sources (id, path, name, source_type, created_at) VALUES ('source', 'C:/content', 'Content', 'local_directory', 'now')", []).unwrap();
        connection.execute("INSERT INTO targets (id, workspace_path, name, posts_directory, resources_directory, created_at) VALUES ('target', 'C:/target', 'Target', '_posts', 'assets', 'now')", []).unwrap();
        connection.execute("INSERT INTO scopes (id, source_id, target_id, name, lifecycle, revision, include_patterns, exclude_patterns, created_at, updated_at) VALUES ('scope', 'source', 'target', 'Scope', 'active', 3, '[]', '[]', 'now', 'now')", []).unwrap();
    }
    fn preview() -> PreviewRecord {
        let binding = ArticleBinding {
            id: "binding".into(),
            target_id: "target".into(),
            scope_id: "scope".into(),
            source_identity: "post.md".into(),
            state: BindingState::Active,
            current_revision: Some("revision".into()),
        };
        let revision = BindingRevision {
            id: "revision".into(),
            binding_id: "binding".into(),
            revision_number: 1,
            state: BindingRevisionState::Active,
            outputs: vec![BindingOutput::proposed_article(
                "_posts/post.md".into(),
                ContentHash::from_bytes(b"post"),
            )],
        };
        PreviewRecord {
            batch: LedgerBatch {
                id: "batch".into(),
                scope_id: "scope".into(),
                target_id: "target".into(),
                change_ids: vec!["change".into()],
                scope_revision: 3,
                target_sequence_before: 0,
                target_head_before: "head".into(),
                state: BatchState::Previewed,
                created_at: "now".into(),
                previewed_at: Some("now".into()),
                commit_sha: None,
                published_at: None,
                rollback_commit_sha: None,
                rolled_back_at: None,
                failure_code: None,
            },
            bindings: vec![binding],
            revisions: vec![revision],
            operations: vec![LedgerOperation {
                id: "operation".into(),
                binding_id: "binding".into(),
                ordinal: 0,
                operation: ReleaseOperation::write(
                    "_posts/post.md",
                    None,
                    ContentHash::from_bytes(b"post"),
                    None,
                ),
            }],
            binding_transitions: vec![BindingTransition {
                binding_id: "binding".into(),
                before_revision_id: None,
                after_revision_id: Some("revision".into()),
            }],
            source_transitions: vec![SourceTransition {
                source_identity: "post.md".into(),
                before: None,
                after: Some(Snapshot {
                    scope_id: "scope".into(),
                    source_identity: "post.md".into(),
                    source_path: "post.md".into(),
                    title: Some("Post".into()),
                    fingerprint: "fingerprint".into(),
                    observed_at: "now".into(),
                }),
            }],
        }
    }
    #[test]
    fn preview_persists_operations_and_target_sequence_after_reopen() {
        let path = temp_db();
        create_scope_and_target(&path);
        let ledger = LedgerRepository::open(&path).unwrap();
        ledger.create_preview(&preview()).unwrap();
        drop(ledger);
        let reopened = LedgerRepository::open(&path).unwrap();
        assert_eq!(reopened.load_operations("batch").unwrap().len(), 1);
        assert_eq!(
            reopened
                .load_batch("batch")
                .unwrap()
                .unwrap()
                .target_sequence_before,
            0
        );
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn legacy_publication_is_visible_but_not_rollback_eligible() {
        let path = temp_db();
        create_scope_and_target(&path);
        let connection = Connection::open(&path).unwrap();
        connection.execute("INSERT INTO publications (batch_id, scope_id, target_id, commit_sha, change_ids, state) VALUES ('legacy', 'scope', 'target', 'sha', '[]', 'published')", []).unwrap();
        drop(connection);
        let ledger = LedgerRepository::open(&path).unwrap();
        assert_eq!(
            ledger.load_batch("legacy").unwrap().unwrap().state,
            BatchState::Legacy
        );
        assert!(ledger.load_operations("legacy").unwrap().is_empty());
        drop(ledger);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn target_accepts_only_one_active_preview() {
        let path = temp_db();
        create_scope_and_target(&path);
        let ledger = LedgerRepository::open(&path).unwrap();
        ledger.create_preview(&preview()).unwrap();

        let mut second = preview();
        second.batch.id = "second".into();
        second.bindings.clear();
        second.revisions.clear();
        second.operations.clear();
        second.binding_transitions.clear();
        second.source_transitions.clear();

        assert!(ledger.create_preview(&second).is_err());
        drop(ledger);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_a_preview_with_stale_target_preconditions() {
        let path = temp_db();
        create_scope_and_target(&path);
        let ledger = LedgerRepository::open(&path).unwrap();
        ledger.create_preview(&preview()).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE release_batches SET state = 'published', published_at = 'later' WHERE batch_id = 'batch'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE target_revisions SET sequence = 1, head_sha = 'new-head', active_batch_id = NULL WHERE target_id = 'target'",
                [],
            )
            .unwrap();
        drop(connection);

        let mut stale = preview();
        stale.batch.id = "stale".into();
        stale.batch.target_sequence_before = 0;
        stale.batch.target_head_before = "head".into();
        stale.bindings.clear();
        stale.revisions.clear();
        stale.operations.clear();
        stale.binding_transitions.clear();
        stale.source_transitions.clear();

        assert!(ledger.create_preview(&stale).is_err());
        drop(ledger);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_a_source_transition_with_a_partial_snapshot() {
        let path = temp_db();
        create_scope_and_target(&path);
        let ledger = LedgerRepository::open(&path).unwrap();
        ledger.create_preview(&preview()).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE release_source_transitions SET after_observed_at = NULL WHERE batch_id = 'batch'",
                [],
            )
            .unwrap();
        drop(connection);

        assert!(ledger.load_source_transitions("batch").is_err());

        drop(ledger);
        std::fs::remove_file(path).unwrap();
    }
}
