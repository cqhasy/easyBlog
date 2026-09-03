use crate::{
    actions,
    app::state::AppState,
    shared::errors::{AppError, AppResult},
};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct PreviewReleaseCommandInput {
    pub scope_id: String,
    pub change_ids: Vec<String>,
}

#[tauri::command]
pub async fn preview_release(
    state: State<'_, AppState>,
    input: PreviewReleaseCommandInput,
) -> AppResult<crate::releases::ReleasePlan> {
    let sources = state.sources.clone();
    let scopes = state.scopes.clone();
    let changes = state.changes.clone();
    let ledger = state.ledger.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let target = target_for_scope(&scopes, &targets, &input.scope_id)?;
        actions::preview_release::execute(
            &sources,
            &scopes,
            &changes,
            &ledger,
            actions::preview_release::PreviewReleaseInput {
                scope_id: input.scope_id,
                target,
                change_ids: input.change_ids,
            },
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "preview_task_failed",
            "Release preview could not be completed",
        )
    })?
}

#[derive(Debug, Deserialize)]
pub struct PublishReleaseCommandInput {
    pub batch_id: String,
}

#[tauri::command]
pub async fn publish_release(
    state: State<'_, AppState>,
    input: PublishReleaseCommandInput,
) -> AppResult<actions::publish_release::Publication> {
    let sources = state.sources.clone();
    let scopes = state.scopes.clone();
    let changes = state.changes.clone();
    let ledger = state.ledger.clone();
    let publications = state.publications.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let batch = ledger
            .load_batch(&input.batch_id)
            .map_err(|_| AppError::new("storage_error", "Release batch could not be loaded"))?
            .ok_or_else(|| {
                AppError::new("release_not_found", "Release preview no longer exists")
            })?;
        let target = targets
            .get(&batch.target_id)
            .map_err(|_| AppError::new("storage_error", "Publishing target could not be loaded"))?
            .map(|connected| connected.target)
            .ok_or_else(|| {
                AppError::new("target_not_found", "The publishing target no longer exists")
            })?;
        actions::publish_release::execute(
            &sources,
            &scopes,
            &changes,
            &ledger,
            &publications,
            target,
            actions::publish_release::PublishReleaseInput {
                batch_id: input.batch_id,
            },
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "publish_task_failed",
            "Release publication could not be completed",
        )
    })?
}

fn target_for_scope(
    scopes: &crate::storage::scopes::ScopeRepository,
    targets: &crate::storage::targets::TargetRepository,
    scope_id: &str,
) -> AppResult<crate::targets::Target> {
    let scope = scopes
        .get(scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    let target_id = scope.target_id.ok_or_else(|| {
        AppError::new("scope_needs_target", "This scope needs a publishing target")
    })?;
    targets
        .get(&target_id)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be loaded"))?
        .map(|connected| connected.target)
        .ok_or_else(|| AppError::new("target_not_found", "The publishing target no longer exists"))
}
