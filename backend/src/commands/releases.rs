use crate::{
    actions,
    app::state::AppState,
    shared::errors::{AppError, AppResult},
    targets::Target,
};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct PreviewReleaseCommandInput {
    pub scope_id: String,
    pub target: Target,
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
    tauri::async_runtime::spawn_blocking(move || {
        actions::preview_release::execute(
            &sources,
            &scopes,
            &changes,
            actions::preview_release::PreviewReleaseInput {
                scope_id: input.scope_id,
                target: input.target,
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
    pub scope_id: String,
    pub target: Target,
    pub change_ids: Vec<String>,
}

#[tauri::command]
pub async fn publish_release(
    state: State<'_, AppState>,
    input: PublishReleaseCommandInput,
) -> AppResult<actions::publish_release::Publication> {
    let sources = state.sources.clone();
    let scopes = state.scopes.clone();
    let changes = state.changes.clone();
    let publications = state.publications.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::publish_release::execute(
            &sources,
            &scopes,
            &changes,
            &publications,
            actions::publish_release::PublishReleaseInput {
                scope_id: input.scope_id,
                target: input.target,
                change_ids: input.change_ids,
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
