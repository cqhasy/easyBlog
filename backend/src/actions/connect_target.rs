use crate::{
    shared::errors::{AppError, AppResult},
    storage::targets::{ConnectedTarget, TargetRepository},
    targets::{check, Target, TargetCheck, TargetCheckError},
};
use chrono::{SecondsFormat, Utc};

pub fn execute(
    targets: &TargetRepository,
    workspace_path: String,
    name: Option<String>,
) -> AppResult<ConnectedTarget> {
    let canonical = std::fs::canonicalize(&workspace_path).map_err(|_| {
        AppError::new(
            "target_workspace_missing",
            "Target folder does not exist or cannot be read",
        )
    })?;
    let target = Target::new(uuid::Uuid::new_v4().to_string(), canonical);
    match check(&target) {
        TargetCheck::Ready { .. } => {}
        TargetCheck::Unsupported { reason } => return Err(check_error(reason)),
    }
    let derived_name = target
        .workspace_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("GitHub Pages")
        .to_owned();
    let connected = ConnectedTarget {
        target,
        name: name
            .unwrap_or_default()
            .trim()
            .to_owned()
            .if_empty(derived_name),
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };
    targets.insert(&connected).map_err(|error| {
        if error
            .to_string()
            .contains("UNIQUE constraint failed: targets.workspace_path")
        {
            AppError::new(
                "duplicate_target",
                "This GitHub Pages repository is already connected",
            )
        } else {
            AppError::new("storage_error", "Publishing target could not be saved")
        }
    })?;
    Ok(connected)
}

trait IfEmpty {
    fn if_empty(self, fallback: String) -> String;
}
impl IfEmpty for String {
    fn if_empty(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn check_error(error: TargetCheckError) -> AppError {
    match error {
        TargetCheckError::MissingWorkspace => {
            AppError::new("target_workspace_missing", "Target folder does not exist")
        }
        TargetCheckError::NotDirectory => {
            AppError::new("target_not_directory", "Target path must be a folder")
        }
        TargetCheckError::NotGitRepository => AppError::new(
            "target_not_git_repository",
            "Choose the root of a cloned GitHub Pages repository",
        ),
        TargetCheckError::MissingPostsDirectory { path } => AppError::new(
            "target_missing_posts_directory",
            format!("Target is missing the required {path} directory"),
        ),
        TargetCheckError::InvalidLayoutPath { path } => AppError::new(
            "target_invalid_layout",
            format!("Target layout path is unsafe: {path}"),
        ),
    }
}
