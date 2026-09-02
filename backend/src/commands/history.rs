use crate::{
    actions,
    app::state::AppState,
    shared::errors::{AppError, AppResult},
    storage::publications::PublicationRecord,
    targets::Target,
};
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub fn list_publications(state: State<'_, AppState>) -> AppResult<Vec<PublicationRecord>> {
    state
        .publications
        .list()
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))
}

#[derive(Debug, Deserialize)]
pub struct PublicationCommandInput {
    pub batch_id: String,
    pub target: Target,
}

#[tauri::command]
pub async fn retry_release(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<()> {
    let changes = state.changes.clone();
    let publications = state.publications.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::retry_release::execute(&changes, &publications, &input.batch_id, &input.target)
    })
    .await
    .map_err(|_| AppError::new("retry_task_failed", "Release retry could not be completed"))?
}

#[tauri::command]
pub async fn rollback_publication(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<String> {
    let publications = state.publications.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::rollback_publication::execute(&publications, &input.batch_id, &input.target)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "rollback_task_failed",
            "Publication rollback could not be completed",
        )
    })?
}
