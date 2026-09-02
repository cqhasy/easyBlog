use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, Result};

use crate::changes::change::{Change, ChangeKind};
use crate::tracking::snapshot::Snapshot;

pub struct ChangeRepository {
    connection: Mutex<Connection>,
}

impl ChangeRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn replace(&self, scope_id: &str, scanned_at: &str, changes: &[Change]) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("change repository lock poisoned");
        let transaction = connection.transaction()?;
        replace_changes(&transaction, scope_id, scanned_at, changes)?;
        transaction.commit()
    }

    pub fn replace_scan_result(
        &self,
        scope_id: &str,
        scanned_at: &str,
        snapshots: &[Snapshot],
        changes: &[Change],
    ) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("change repository lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM snapshots WHERE scope_id = ?1", [scope_id])?;
        for snapshot in snapshots {
            transaction.execute("INSERT INTO snapshots (scope_id, source_identity, source_path, title, fingerprint, observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![snapshot.scope_id, snapshot.source_identity, snapshot.source_path, snapshot.title, snapshot.fingerprint, snapshot.observed_at])?;
        }
        replace_changes(&transaction, scope_id, scanned_at, changes)?;
        transaction.commit()
    }

    pub fn list(&self, scope_id: &str) -> Result<Vec<Change>> {
        let connection = self
            .connection
            .lock()
            .expect("change repository lock poisoned");
        let mut statement = connection.prepare("SELECT id, scope_id, change_kind, source_identity, source_path, previous_path, title, selected, blocked_reason, fingerprint, scanned_at FROM changes WHERE scope_id = ?1 ORDER BY source_path")?;
        let changes = statement
            .query_map([scope_id], |row| {
                let fingerprint: Option<String> = row.get(9)?;
                let observed_at: String = row.get(10)?;
                let scope_id: String = row.get(1)?;
                let source_identity: String = row.get(3)?;
                let source_path: String = row.get(4)?;
                Ok(Change {
                    id: row.get(0)?,
                    scope_id: scope_id.clone(),
                    kind: kind_from(&row.get::<_, String>(2)?),
                    source_identity: source_identity.clone(),
                    source_path: source_path.clone(),
                    previous_path: row.get(5)?,
                    title: row.get(6)?,
                    selected: row.get(7)?,
                    blocked_reason: row.get(8)?,
                    snapshot: fingerprint.map(|fingerprint| crate::tracking::snapshot::Snapshot {
                        scope_id,
                        source_identity,
                        source_path,
                        title: None,
                        fingerprint,
                        observed_at,
                    }),
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(changes)
    }

    pub fn remove(&self, scope_id: &str, change_ids: &[String]) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("change repository lock poisoned");
        let transaction = connection.transaction()?;
        for id in change_ids {
            transaction.execute(
                "DELETE FROM changes WHERE scope_id = ?1 AND id = ?2",
                params![scope_id, id],
            )?;
        }
        transaction.commit()
    }
}

fn replace_changes(
    transaction: &rusqlite::Transaction<'_>,
    scope_id: &str,
    scanned_at: &str,
    changes: &[Change],
) -> Result<()> {
    transaction.execute("DELETE FROM changes WHERE scope_id = ?1", [scope_id])?;
    for change in changes {
        transaction.execute("INSERT INTO changes (id, scope_id, change_kind, source_identity, source_path, previous_path, title, selected, blocked_reason, fingerprint, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)", params![change.id, change.scope_id, kind_name(&change.kind), change.source_identity, change.source_path, change.previous_path, change.title, change.selected, change.blocked_reason, change.snapshot.as_ref().map(|snapshot| snapshot.fingerprint.clone()), scanned_at])?;
    }
    Ok(())
}

fn kind_name(kind: &ChangeKind) -> &'static str {
    match kind {
        ChangeKind::Added => "added",
        ChangeKind::Updated => "updated",
        ChangeKind::Moved => "moved",
        ChangeKind::Deleted => "deleted",
        ChangeKind::Blocked => "blocked",
    }
}

fn kind_from(kind: &str) -> ChangeKind {
    match kind {
        "updated" => ChangeKind::Updated,
        "moved" => ChangeKind::Moved,
        "deleted" => ChangeKind::Deleted,
        "blocked" => ChangeKind::Blocked,
        _ => ChangeKind::Added,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::scopes::scope::{Scope, ScopeLifecycle};
    use crate::sources::source::Source;
    use crate::storage::scopes::ScopeRepository;
    use crate::storage::sources::SourceRepository;
    use crate::tracking::snapshot::Snapshot;

    use super::*;

    fn temp_db() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("easyblog-changes-{suffix}.db"))
    }

    fn create_scope(path: &std::path::Path) {
        let sources = SourceRepository::open(path).unwrap();
        sources
            .insert(&Source {
                id: "source".into(),
                path: "C:/content".into(),
                name: "Content".into(),
                r#type: "local_directory".into(),
                created_at: "2026-09-02T00:00:00Z".into(),
            })
            .unwrap();
        let scopes = ScopeRepository::open(path).unwrap();
        scopes
            .save(
                &Scope {
                    id: "scope".into(),
                    source_id: "source".into(),
                    target_id: None,
                    name: "Posts".into(),
                    lifecycle: ScopeLifecycle::Active,
                    revision: 1,
                    selections: vec![],
                    include_patterns: vec![],
                    exclude_patterns: vec![],
                    created_at: "2026-09-02T00:00:00Z".into(),
                    updated_at: "2026-09-02T00:00:00Z".into(),
                },
                None,
            )
            .unwrap();
    }

    #[test]
    fn persists_change_metadata_across_reopen() {
        let path = temp_db();
        create_scope(&path);
        let scanned_at = "2026-09-02T12:00:00Z";
        let changes = vec![
            Change {
                id: "scope:new.md:fingerprint".into(),
                scope_id: "scope".into(),
                kind: ChangeKind::Moved,
                source_identity: "new.md".into(),
                source_path: "new.md".into(),
                previous_path: Some("old.md".into()),
                title: Some("New title".into()),
                selected: true,
                blocked_reason: None,
                snapshot: Some(Snapshot {
                    scope_id: "scope".into(),
                    source_identity: "new.md".into(),
                    source_path: "new.md".into(),
                    title: Some("New title".into()),
                    fingerprint: "fingerprint".into(),
                    observed_at: scanned_at.into(),
                }),
            },
            Change {
                id: "scope:broken.md:blocked".into(),
                scope_id: "scope".into(),
                kind: ChangeKind::Blocked,
                source_identity: "broken.md".into(),
                source_path: "broken.md".into(),
                previous_path: None,
                title: None,
                selected: false,
                blocked_reason: Some("Markdown content could not be normalized".into()),
                snapshot: None,
            },
        ];
        {
            let repository = ChangeRepository::open(&path).unwrap();
            repository.replace("scope", scanned_at, &changes).unwrap();
        }

        let repository = ChangeRepository::open(&path).unwrap();
        let persisted = repository.list("scope").unwrap();
        assert_eq!(persisted.len(), 2);
        assert_eq!(persisted[0].kind, ChangeKind::Blocked);
        assert_eq!(
            persisted[0].blocked_reason.as_deref(),
            Some("Markdown content could not be normalized")
        );
        assert_eq!(persisted[1].kind, ChangeKind::Moved);
        assert_eq!(persisted[1].previous_path.as_deref(), Some("old.md"));
        assert!(persisted[1].selected);
        assert_eq!(
            persisted[1]
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.fingerprint.as_str()),
            Some("fingerprint")
        );

        drop(repository);
        std::fs::remove_file(path).unwrap();
    }
}
