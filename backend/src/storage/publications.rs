use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublicationRecord {
    pub batch_id: String,
    pub scope_id: String,
    pub target_id: String,
    pub commit_sha: String,
    pub change_ids: Vec<String>,
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
            "INSERT INTO publications (batch_id, scope_id, target_id, commit_sha, change_ids, state, published_at, rollback_commit_sha, rolled_back_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending_push', NULL, NULL, NULL)",
            params![record.batch_id, record.scope_id, record.target_id, record.commit_sha, serde_json::to_string(&record.change_ids).unwrap()],
        )?;
        Ok(())
    }

    pub fn get(&self, batch_id: &str) -> Result<Option<PublicationRecord>> {
        let connection = self
            .connection
            .lock()
            .expect("publication repository lock poisoned");
        connection.query_row("SELECT batch_id, scope_id, target_id, commit_sha, change_ids, state, published_at, rollback_commit_sha, rolled_back_at FROM publications WHERE batch_id = ?1", [batch_id], row).optional()
    }

    pub fn list(&self) -> Result<Vec<PublicationRecord>> {
        let connection = self
            .connection
            .lock()
            .expect("publication repository lock poisoned");
        let mut statement = connection.prepare("SELECT batch_id, scope_id, target_id, commit_sha, change_ids, state, published_at, rollback_commit_sha, rolled_back_at FROM publications ORDER BY COALESCE(published_at, '') DESC, batch_id DESC")?;
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
        self.connection.lock().expect("publication repository lock poisoned").execute("UPDATE publications SET state = 'rolled_back', rollback_commit_sha = ?2, rolled_back_at = ?3 WHERE batch_id = ?1 AND state = 'published'", params![batch_id, commit_sha, rolled_back_at])?;
        Ok(())
    }
}

fn row(row: &rusqlite::Row<'_>) -> Result<PublicationRecord> {
    let state: String = row.get(5)?;
    let change_ids: String = row.get(4)?;
    Ok(PublicationRecord {
        batch_id: row.get(0)?,
        scope_id: row.get(1)?,
        target_id: row.get(2)?,
        commit_sha: row.get(3)?,
        change_ids: serde_json::from_str(&change_ids).unwrap_or_default(),
        state: match state.as_str() {
            "pending_push" => PublicationState::PendingPush,
            "rolled_back" => PublicationState::RolledBack,
            _ => PublicationState::Published,
        },
        published_at: row.get(6)?,
        rollback_commit_sha: row.get(7)?,
        rolled_back_at: row.get(8)?,
    })
}
