use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, Result};

use crate::changes::change::{Change, ChangeKind};

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
        transaction.execute("DELETE FROM changes WHERE scope_id = ?1", [scope_id])?;
        for change in changes {
            transaction.execute("INSERT INTO changes (id, scope_id, change_kind, source_identity, source_path, previous_path, title, selected, blocked_reason, fingerprint, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)", params![change.id, change.scope_id, kind_name(&change.kind), change.source_identity, change.source_path, change.previous_path, change.title, change.selected, change.blocked_reason, change.snapshot.as_ref().map(|snapshot| snapshot.fingerprint.clone()), scanned_at])?;
        }
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
