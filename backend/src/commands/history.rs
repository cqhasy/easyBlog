use crate::{
    actions,
    app::state::AppState,
    shared::errors::{AppError, AppResult},
    storage::publications::PublicationRecord,
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
}

#[tauri::command]
pub async fn retry_release(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<()> {
    let changes = state.changes.clone();
    let publications = state.publications.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let target = target_for_publication(&publications, &targets, &input.batch_id)?;
        actions::retry_release::execute(&changes, &publications, &input.batch_id, &target)
    })
    .await
    .map_err(|_| AppError::new("retry_task_failed", "Release retry could not be completed"))?
}

#[tauri::command]
pub async fn rollback_publication(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<String> {
    let changes = state.changes.clone();
    let publications = state.publications.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let target = target_for_publication(&publications, &targets, &input.batch_id)?;
        actions::rollback_publication::execute(&changes, &publications, &input.batch_id, &target)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "rollback_task_failed",
            "Publication rollback could not be completed",
        )
    })?
}

fn target_for_publication(
    publications: &crate::storage::publications::PublicationRepository,
    targets: &crate::storage::targets::TargetRepository,
    batch_id: &str,
) -> AppResult<crate::targets::Target> {
    let publication = publications
        .get(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))?
        .ok_or_else(|| {
            AppError::new("publication_not_found", "This publication no longer exists")
        })?;
    targets
        .get(&publication.target_id)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be loaded"))?
        .map(|connected| connected.target)
        .ok_or_else(|| AppError::new("target_not_found", "The publishing target no longer exists"))
}
