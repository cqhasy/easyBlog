use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

use chrono::{SecondsFormat, Utc};

use crate::{
    providers::git::{GitCommandError, GitCommands},
    shared::errors::{AppError, AppResult},
    storage::targets::{ConnectedTarget, TargetRepository},
    targets::{Target, TargetState, TargetVisibility},
};

pub struct ConnectTargetInput {
    pub repository: String,
    pub default_branch: String,
    pub visibility: TargetVisibility,
}

pub fn execute(
    targets: &TargetRepository,
    workspace_root: &Path,
    input: ConnectTargetInput,
) -> AppResult<ConnectedTarget> {
    validate_repository(&input.repository)?;
    let repository = canonical_repository(&input.repository);
    let key = format!("{repository}/{}", input.default_branch);
    let binding = repository_connection_lock(&key);
    let _connection_guard = binding.lock().expect("repository connection lock poisoned");
    if let Some(existing) = targets
        .find_by_repository(&repository, &input.default_branch)
        .map_err(storage_error)?
    {
        return Ok(existing);
    }
    std::fs::create_dir_all(workspace_root).map_err(|_| {
        AppError::new(
            "workspace_unavailable",
            "easyBlog workspace could not be prepared",
        )
    })?;
    let id = uuid::Uuid::new_v4().to_string();
    let workspace_path = workspace_root.join(&id);
    let clone_url = format!("https://github.com/{repository}.git");
    let workspace_argument = workspace_path.to_string_lossy().into_owned();
    let cloned = match GitCommands::run_output(
        workspace_root,
        &["clone", &clone_url, &workspace_argument],
    ) {
        Ok(output) => output,
        Err(error) => {
            let _ = remove_new_workspace(workspace_root, &workspace_path);
            return Err(git_prepare_error(error));
        }
    };
    if !cloned.status.success() {
        let _ = remove_new_workspace(workspace_root, &workspace_path);
        return Err(AppError::new(
            "target_clone_failed",
            "GitHub repository could not be prepared. Check your access and try again.",
        ));
    }
    if let Err(error) = fetch_prune(&workspace_path) {
        let _ = remove_new_workspace(workspace_root, &workspace_path);
        return Err(error);
    }
    let target = Target {
        id,
        workspace_path,
        repository: repository.clone(),
        default_branch: input.default_branch,
        visibility: input.visibility,
        // Connecting a repository must not guess its publishing adapter or content paths.
        state: TargetState::NeedsConfiguration,
        layout: Default::default(),
    };
    let connected = ConnectedTarget {
        name: repository,
        target,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };
    if targets.insert(&connected).is_err() {
        let _ = remove_new_workspace(workspace_root, &connected.target.workspace_path);
        return Err(AppError::new(
            "storage_error",
            "Publishing target could not be saved",
        ));
    }
    Ok(connected)
}

fn repository_connection_lock(key: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().expect("repository connection locks poisoned");
    locks
        .entry(key.to_owned())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn fetch_prune(root: &Path) -> AppResult<()> {
    let output = GitCommands::run_output(root, &["fetch", "--prune", "origin"])
        .map_err(git_prepare_error)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "target_clone_failed",
            "GitHub repository could not be prepared. Check your access and try again.",
        ))
    }
}

fn git_prepare_error(error: GitCommandError) -> AppError {
    match error {
        GitCommandError::TimedOut => AppError::new(
            "git_timeout",
            "GitHub repository preparation timed out. Check your network and try again.",
        ),
        _ => AppError::new(
            "git_unavailable",
            "Git is required to prepare this repository",
        ),
    }
}
fn validate_repository(repository: &str) -> AppResult<()> {
    let valid = repository.split('/').count() == 2
        && repository.split('/').all(|part| {
            !part.is_empty()
                && part.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
                })
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            "invalid_repository",
            "Choose a GitHub repository from the list",
        ))
    }
}

fn canonical_repository(repository: &str) -> String {
    repository.to_ascii_lowercase()
}
fn remove_new_workspace(root: &Path, path: &Path) -> std::io::Result<()> {
    let root = std::fs::canonicalize(root)?;
    if path
        .parent()
        .and_then(|parent| std::fs::canonicalize(parent).ok())
        .as_deref()
        == Some(root.as_path())
    {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}
fn storage_error(_: rusqlite::Error) -> AppError {
    AppError::new("storage_error", "Publishing target could not be loaded")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_repository_identity_without_changing_branch_identity() {
        assert_eq!(canonical_repository("Owner/Blog"), "owner/blog");
        assert_eq!("Main", "Main");
    }

    #[test]
    fn rejects_invalid_repository_identity() {
        assert!(validate_repository("owner/blog").is_ok());
        assert!(validate_repository("owner/blog/extra").is_err());
        assert!(validate_repository("owner/invalid name").is_err());
    }
}
