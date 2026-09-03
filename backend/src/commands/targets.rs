use crate::{
    actions,
    app::state::AppState,
    providers::github::repository::{self, GithubRepository, GithubRepositoryError},
    shared::errors::{AppError, AppResult},
    storage::targets::ConnectedTarget,
    targets::{PublishingAdapter, TargetVisibility},
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
pub fn list_targets(state: State<'_, AppState>) -> AppResult<Vec<ConnectedTarget>> {
    actions::list_targets::execute(&state.targets)
}

#[tauri::command]
pub fn inspect_target_configuration(
    state: State<'_, AppState>,
    target_id: String,
) -> AppResult<Vec<actions::configure_target::LayoutCandidate>> {
    actions::configure_target::inspect(&state.targets, &target_id)
}

#[tauri::command]
pub fn save_target_configuration(
    state: State<'_, AppState>,
    target_id: String,
    adapter: String,
    posts_directory: String,
    resources_directory: String,
) -> AppResult<ConnectedTarget> {
    actions::configure_target::save(
        &state.targets,
        actions::configure_target::ConfigureTargetInput {
            target_id,
            adapter: match adapter.as_str() {
                "github_pages" => PublishingAdapter::GithubPages,
                "astro_content" => PublishingAdapter::AstroContent,
                _ => {
                    return Err(AppError::new(
                        "unsupported_adapter",
                        "Choose a supported publishing adapter",
                    ))
                }
            },
            posts_directory,
            resources_directory,
        },
    )
}

#[tauri::command]
pub fn preview_target_initialization(
    state: State<'_, AppState>,
    target_id: String,
) -> AppResult<actions::configure_target::InitializationPreview> {
    actions::configure_target::preview_initialization(&state.targets, &target_id)
}

#[tauri::command]
pub fn initialize_target(
    state: State<'_, AppState>,
    target_id: String,
    confirmed: bool,
) -> AppResult<ConnectedTarget> {
    if !confirmed {
        return Err(AppError::new(
            "initialization_not_confirmed",
            "Confirm the initialization preview before writing publishing files",
        ));
    }
    actions::configure_target::initialize(&state.targets, &target_id)
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
