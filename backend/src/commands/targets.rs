use crate::{
    actions,
    app::state::AppState,
    providers::github::repository::{self, GithubRepository, GithubRepositoryError},
    shared::errors::{AppError, AppResult},
    storage::targets::ConnectedTarget,
    targets::TargetVisibility,
};
use tauri::State;

#[tauri::command]
pub async fn connect_target(
    state: State<'_, AppState>,
    repository: String,
    default_branch: String,
    visibility: String,
) -> AppResult<ConnectedTarget> {
    let targets = state.targets.clone();
    let workspace_root = state.workspace_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        actions::github_auth::prepare_git_credentials()?;
        actions::connect_target::execute(
            &targets,
            &workspace_root,
            actions::connect_target::ConnectTargetInput {
                repository,
                default_branch,
                visibility: if visibility == "public" {
                    TargetVisibility::Public
                } else {
                    TargetVisibility::Private
                },
            },
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "target_connection_failed",
            "GitHub target could not be connected",
        )
    })?
}

#[tauri::command]
pub async fn list_github_repositories() -> AppResult<Vec<GithubRepository>> {
    tauri::async_runtime::spawn_blocking(|| {
        actions::github_auth::require_ready()?;
        repository::list_pushable().map_err(repository_error)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "github_repository_list_failed",
            "GitHub repositories could not be loaded",
        )
    })?
}

#[tauri::command]
pub async fn refresh_github_repository_permissions() -> AppResult<Vec<GithubRepository>> {
    tauri::async_runtime::spawn_blocking(|| {
        actions::github_auth::require_ready()?;
        repository::list_pushable().map_err(repository_error)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "github_repository_list_failed",
            "GitHub repositories could not be reloaded",
        )
    })?
}

#[tauri::command]
pub async fn initialize_target(
    state: State<'_, AppState>,
    target_id: String,
) -> AppResult<ConnectedTarget> {
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        actions::connect_target::initialize(&targets, &target_id)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "target_initialization_failed",
            "Blog structure could not be initialized",
        )
    })?
}

#[tauri::command]
pub fn list_targets(state: State<'_, AppState>) -> AppResult<Vec<ConnectedTarget>> {
    actions::list_targets::execute(&state.targets)
}

fn repository_error(error: GithubRepositoryError) -> AppError {
    match error {
        GithubRepositoryError::Unavailable => AppError::new(
            "github_cli_missing",
            "GitHub CLI is required to list repositories",
        ),
        GithubRepositoryError::Failed => AppError::new(
            "github_repository_list_failed",
            "GitHub repositories could not be loaded. Check your account permissions.",
        ),
        GithubRepositoryError::InvalidResponse => AppError::new(
            "github_repository_list_failed",
            "GitHub returned an unreadable repository list",
        ),
    }
}
