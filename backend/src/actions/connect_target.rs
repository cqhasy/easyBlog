use std::{
    collections::HashMap,
    path::Path,
    process::Command,
    sync::{Arc, Mutex, OnceLock},
};

use chrono::{SecondsFormat, Utc};

use crate::{
    shared::errors::{AppError, AppResult},
    storage::targets::{ConnectedTarget, TargetRepository},
    targets::{check, Target, TargetCheck, TargetState, TargetVisibility},
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
    let key = format!(
        "{}/{}",
        input.repository.to_ascii_lowercase(),
        input.default_branch.to_ascii_lowercase()
    );
    let binding = repository_connection_lock(&key);
    let _connection_guard = binding.lock().expect("repository connection lock poisoned");
    if let Some(existing) = targets
        .find_by_repository(&input.repository, &input.default_branch)
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
    let clone_url = format!("https://github.com/{}.git", input.repository);
    let cloned = Command::new("git")
        .args(["clone", &clone_url])
        .arg(&workspace_path)
        .output()
        .map_err(|_| {
            AppError::new(
                "git_unavailable",
                "Git is required to prepare this repository",
            )
        })?;
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
    let mut target = Target {
        id,
        workspace_path,
        repository: input.repository.clone(),
        default_branch: input.default_branch,
        visibility: input.visibility,
        state: TargetState::Ready,
        layout: Default::default(),
    };
    target.state = match check(&target) {
        TargetCheck::Ready { .. } => TargetState::Ready,
        TargetCheck::NeedsInitialization => TargetState::NeedsInitialization,
        TargetCheck::Unsupported { .. } => TargetState::NeedsRecovery,
    };
    let connected = ConnectedTarget {
        name: input.repository,
        target,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };
    targets
        .insert(&connected)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be saved"))?;
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

pub fn initialize(targets: &TargetRepository, id: &str) -> AppResult<ConnectedTarget> {
    let mut target = targets
        .get(id)
        .map_err(storage_error)?
        .ok_or_else(|| AppError::new("target_not_found", "Publishing target no longer exists"))?;
    if target.target.state != TargetState::NeedsInitialization {
        return Err(AppError::new(
            "target_not_initializable",
            "This target does not need initialization",
        ));
    }
    let root = &target.target.workspace_path;
    let current_branch = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(root)
        .output()
        .map_err(|_| {
            AppError::new(
                "git_unavailable",
                "Git is required to prepare this repository",
            )
        })?;
    if current_branch.status.success()
        && String::from_utf8_lossy(&current_branch.stdout).trim() != target.target.default_branch
    {
        git(root, &["checkout", "-B", &target.target.default_branch])?;
    }
    std::fs::create_dir_all(root.join(&target.target.layout.posts_directory)).map_err(|_| {
        AppError::new(
            "target_initialization_failed",
            "Blog structure could not be created",
        )
    })?;
    std::fs::create_dir_all(root.join(&target.target.layout.resources_directory)).map_err(
        |_| {
            AppError::new(
                "target_initialization_failed",
                "Blog structure could not be created",
            )
        },
    )?;
    let marker = root
        .join(&target.target.layout.posts_directory)
        .join(".gitkeep");
    if !marker.exists() {
        std::fs::write(&marker, "").map_err(|_| {
            AppError::new(
                "target_initialization_failed",
                "Blog structure could not be created",
            )
        })?;
    }
    git(root, &["add", "--", "."])?;
    git(
        root,
        &[
            "-c",
            "user.name=easyBlog",
            "-c",
            "user.email=easyblog@local",
            "commit",
            "-m",
            "Initialize easyBlog structure",
        ],
    )?;
    git(
        root,
        &[
            "push",
            "origin",
            &format!("HEAD:{}", target.target.default_branch),
        ],
    )?;
    target.target.state = TargetState::Ready;
    targets.update(&target).map_err(storage_error)?;
    Ok(target)
}

fn git(root: &Path, arguments: &[&str]) -> AppResult<()> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .map_err(|_| {
            AppError::new(
                "git_unavailable",
                "Git is required to prepare this repository",
            )
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "target_initialization_failed",
            "Blog structure could not be initialized and pushed",
        ))
    }
}

fn fetch_prune(root: &Path) -> AppResult<()> {
    let output = Command::new("git")
        .args(["fetch", "--prune", "origin"])
        .current_dir(root)
        .output()
        .map_err(|_| {
            AppError::new(
                "git_unavailable",
                "Git is required to prepare this repository",
            )
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "target_clone_failed",
            "GitHub repository could not be prepared. Check your access and try again.",
        ))
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
