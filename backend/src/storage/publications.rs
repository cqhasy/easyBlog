use std::{path::Path, sync::Mutex};

use rusqlite::{params, types::Type, Connection, Error, OptionalExtension, Result};
use serde::Serialize;

use crate::tracking::snapshot::Snapshot;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublicationRecord {
    pub batch_id: String,
    pub scope_id: String,
    pub target_id: String,
    pub commit_sha: String,
    pub change_ids: Vec<String>,
    #[serde(skip)]
    pub snapshots_before_publish: Option<Vec<Snapshot>>,
    pub state: PublicationState,
    pub published_at: Option<String>,
    pub rollback_commit_sha: Option<String>,
    pub rolled_back_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationState {
    PendingPush,
    Published,
    RollbackPending,
    RolledBack,
}

pub struct PublicationRepository {
    connection: Mutex<Connection>,
}

impl PublicationRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn insert_pending(&self, record: &PublicationRecord) -> Result<()> {
        self.connection.lock().expect("publication repository lock poisoned").execute(
            "INSERT INTO publications (batch_id, scope_id, target_id, commit_sha, change_ids, snapshots_before_publish, state, published_at, rollback_commit_sha, rolled_back_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending_push', NULL, NULL, NULL)",
            params![record.batch_id, record.scope_id, record.target_id, record.commit_sha, serde_json::to_string(&record.change_ids).unwrap(), record.snapshots_before_publish.as_ref().map(|snapshots| serde_json::to_string(snapshots).unwrap())],
        )?;
        Ok(())
    }

    pub fn get(&self, batch_id: &str) -> Result<Option<PublicationRecord>> {
        let connection = self
            .connection
            .lock()
            .expect("publication repository lock poisoned");
        connection.query_row("SELECT batch_id, scope_id, target_id, commit_sha, change_ids, snapshots_before_publish, state, published_at, rollback_commit_sha, rolled_back_at FROM publications WHERE batch_id = ?1", [batch_id], row).optional()
    }

    pub fn list(&self) -> Result<Vec<PublicationRecord>> {
        let connection = self
            .connection
            .lock()
            .expect("publication repository lock poisoned");
        let mut statement = connection.prepare("SELECT batch_id, scope_id, target_id, commit_sha, change_ids, snapshots_before_publish, state, published_at, rollback_commit_sha, rolled_back_at FROM publications ORDER BY COALESCE(published_at, '') DESC, batch_id DESC")?;
        let records = statement
            .query_map([], row)?
            .collect::<Result<Vec<PublicationRecord>>>()?;
        Ok(records)
    }

    pub fn mark_published(&self, batch_id: &str, published_at: &str) -> Result<()> {
        self.connection.lock().expect("publication repository lock poisoned").execute("UPDATE publications SET state = 'published', published_at = ?2 WHERE batch_id = ?1 AND state = 'pending_push'", params![batch_id, published_at])?;
        Ok(())
    }

    pub fn mark_rolled_back(
        &self,
        batch_id: &str,
        commit_sha: &str,
        rolled_back_at: &str,
    ) -> Result<()> {
        self.connection.lock().expect("publication repository lock poisoned").execute("UPDATE publications SET state = 'rolled_back', rollback_commit_sha = ?2, rolled_back_at = ?3 WHERE batch_id = ?1 AND state = 'rollback_pending'", params![batch_id, commit_sha, rolled_back_at])?;
        Ok(())
    }

    pub fn mark_rollback_pending(&self, batch_id: &str, commit_sha: &str) -> Result<()> {
        self.connection.lock().expect("publication repository lock poisoned").execute("UPDATE publications SET state = 'rollback_pending', rollback_commit_sha = ?2 WHERE batch_id = ?1 AND state = 'published'", params![batch_id, commit_sha])?;
        Ok(())
    }

    pub fn is_latest_reversible(&self, record: &PublicationRecord) -> Result<bool> {
        let connection = self
            .connection
            .lock()
            .expect("publication repository lock poisoned");
        let latest = connection
            .query_row(
                "SELECT batch_id FROM publications WHERE scope_id = ?1 AND target_id = ?2 AND state IN ('published', 'rollback_pending') ORDER BY COALESCE(published_at, '') DESC, batch_id DESC LIMIT 1",
                params![record.scope_id, record.target_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(latest.as_deref() == Some(&record.batch_id))
    }
}

fn row(row: &rusqlite::Row<'_>) -> Result<PublicationRecord> {
    let state: String = row.get(6)?;
    let change_ids: String = row.get(4)?;
    let change_ids = serde_json::from_str(&change_ids)
        .map_err(|error| Error::FromSqlConversionFailure(4, Type::Text, Box::new(error)))?;
    let snapshots_before_publish = row
        .get::<_, Option<String>>(5)?
        .map(|snapshots| serde_json::from_str(&snapshots))
        .transpose()
        .map_err(|error| Error::FromSqlConversionFailure(5, Type::Text, Box::new(error)))?;
    Ok(PublicationRecord {
        batch_id: row.get(0)?,
        scope_id: row.get(1)?,
        target_id: row.get(2)?,
        commit_sha: row.get(3)?,
        change_ids,
        snapshots_before_publish,
        state: match state.as_str() {
            "pending_push" => PublicationState::PendingPush,
            "published" => PublicationState::Published,
            "rollback_pending" => PublicationState::RollbackPending,
            "rolled_back" => PublicationState::RolledBack,
            _ => {
                return Err(Error::FromSqlConversionFailure(
                    6,
                    Type::Text,
                    format!("Unknown publication state: {state}").into(),
                ));
            }
        },
        published_at: row.get(7)?,
        rollback_commit_sha: row.get(8)?,
        rolled_back_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use rusqlite::Connection;

    use super::*;

    fn temp_db() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("easyblog-publications-{suffix}.db"))
    }

    fn insert_raw(path: &std::path::Path, state: &str, change_ids: &str) {
        let connection = Connection::open(path).unwrap();
        connection.execute("PRAGMA foreign_keys = ON", []).unwrap();
        connection
            .execute(
                "INSERT INTO sources (id, path, name, source_type, created_at) VALUES ('source', 'C:/content', 'Content', 'local_directory', 'now')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO scopes (id, source_id, name, lifecycle, revision, include_patterns, exclude_patterns, created_at, updated_at) VALUES ('scope', 'source', 'Posts', 'active', 1, '[]', '[]', 'now', 'now')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO publications (batch_id, scope_id, target_id, commit_sha, change_ids, state) VALUES ('batch', 'scope', 'target', 'sha', ?1, ?2)",
                params![change_ids, state],
            )
            .unwrap();
    }

    #[test]
    fn rejects_an_unknown_persisted_state() {
        let path = temp_db();
        let repository = PublicationRepository::open(&path).unwrap();
        insert_raw(&path, "mystery", "[]");

        assert!(repository.get("batch").is_err());

        drop(repository);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_corrupt_persisted_change_ids() {
        let path = temp_db();
        let repository = PublicationRepository::open(&path).unwrap();
        insert_raw(&path, "published", "not-json");

        assert!(repository.get("batch").is_err());

        drop(repository);
        std::fs::remove_file(path).unwrap();
    }
}
