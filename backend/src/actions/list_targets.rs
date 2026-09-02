use crate::{
    shared::errors::{AppError, AppResult},
    storage::targets::{ConnectedTarget, TargetRepository},
};

pub fn execute(targets: &TargetRepository) -> AppResult<Vec<ConnectedTarget>> {
    targets
        .list()
        .map_err(|_| AppError::new("storage_error", "Publishing targets could not be loaded"))
}
