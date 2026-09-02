use crate::storage::changes::ChangeRepository;
use crate::storage::scopes::ScopeRepository;
use crate::storage::snapshots::SnapshotRepository;
use crate::storage::sources::SourceRepository;
use std::path::Path;
use std::sync::Arc;

pub struct AppState {
    pub sources: Arc<SourceRepository>,
    pub scopes: Arc<ScopeRepository>,
    pub snapshots: Arc<SnapshotRepository>,
    pub changes: Arc<ChangeRepository>,
}

impl AppState {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self, rusqlite::Error> {
        Ok(Self {
            sources: Arc::new(SourceRepository::open(&db_path)?),
            scopes: Arc::new(ScopeRepository::open(&db_path)?),
            snapshots: Arc::new(SnapshotRepository::open(&db_path)?),
            changes: Arc::new(ChangeRepository::open(&db_path)?),
        })
    }
}
