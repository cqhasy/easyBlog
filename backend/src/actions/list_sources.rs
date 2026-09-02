use crate::shared::errors::{AppError, AppResult};
use crate::sources::source::Source;
use crate::storage::sources::SourceRepository;

pub fn execute(repository: &SourceRepository) -> AppResult<Vec<Source>> {
    repository
        .list()
        .map_err(|_| AppError::new("storage_error", "Sources could not be loaded"))
}
