use crate::storage::sources::SourceRepository;
use std::path::Path;
use std::sync::Arc;

pub struct AppState {
    pub sources: Arc<SourceRepository>,
}

impl AppState {
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self, rusqlite::Error> {
        Ok(Self {
            sources: Arc::new(SourceRepository::open(db_path)?),
        })
    }
}
