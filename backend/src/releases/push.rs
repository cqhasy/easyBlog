use crate::{
    providers::git::GitCommands,
    shared::errors::{AppError, AppResult},
};
use std::path::Path;

pub fn execute(root: &Path) -> AppResult<()> {
    GitCommands::run(root, &["push"]).map_err(|_| {
        AppError::new(
            "git_push_failed",
            "The release commit was created but could not be pushed",
        )
    })?;
    Ok(())
}
