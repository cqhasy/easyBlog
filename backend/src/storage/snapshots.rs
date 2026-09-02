use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, Result};

use crate::tracking::snapshot::Snapshot;

pub struct SnapshotRepository {
    connection: Mutex<Connection>,
}

impl SnapshotRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn list(&self, scope_id: &str) -> Result<Vec<Snapshot>> {
        let connection = self
            .connection
            .lock()
            .expect("snapshot repository lock poisoned");
        let mut statement = connection.prepare("SELECT scope_id, source_identity, source_path, title, fingerprint, observed_at FROM snapshots WHERE scope_id = ?1 ORDER BY source_path")?;
        let snapshots = statement
            .query_map([scope_id], snapshot_from_row)?
            .collect::<Result<Vec<_>>>()?;
        Ok(snapshots)
    }

    pub fn replace(&self, scope_id: &str, snapshots: &[Snapshot]) -> Result<()> {
        let mut connection = self
            .connection
            .lock()
            .expect("snapshot repository lock poisoned");
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM snapshots WHERE scope_id = ?1", [scope_id])?;
        for snapshot in snapshots {
            transaction.execute("INSERT INTO snapshots (scope_id, source_identity, source_path, title, fingerprint, observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![snapshot.scope_id, snapshot.source_identity, snapshot.source_path, snapshot.title, snapshot.fingerprint, snapshot.observed_at])?;
        }
        transaction.commit()
    }
}

fn snapshot_from_row(row: &rusqlite::Row<'_>) -> Result<Snapshot> {
    Ok(Snapshot {
        scope_id: row.get(0)?,
        source_identity: row.get(1)?,
        source_path: row.get(2)?,
        title: row.get(3)?,
        fingerprint: row.get(4)?,
        observed_at: row.get(5)?,
    })
}
