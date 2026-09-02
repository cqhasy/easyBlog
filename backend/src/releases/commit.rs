use crate::{
    providers::git::GitCommands,
    shared::errors::{AppError, AppResult},
};
use std::path::Path;

pub fn create(root: &Path, message: &str) -> AppResult<String> {
    GitCommands::run(root, &["add", "--all"])
        .map_err(|_| AppError::new("git_stage_failed", "Release files could not be staged"))?;
    GitCommands::run(
        root,
        &[
            "-c",
            "user.name=easyBlog",
            "-c",
            "user.email=easyblog@local",
            "commit",
            "-m",
            message,
        ],
    )
    .map_err(|_| AppError::new("git_commit_failed", "Release files could not be committed"))?;
    GitCommands::commit_sha(root).map_err(|_| {
        AppError::new(
            "git_commit_failed",
            "The release commit could not be identified",
        )
    })
}
