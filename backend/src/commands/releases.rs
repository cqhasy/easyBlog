use crate::{actions, app::state::AppState, shared::errors::AppResult, targets::Target};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct PreviewReleaseCommandInput {
    pub scope_id: String,
    pub target: Target,
    pub change_ids: Vec<String>,
}

#[tauri::command]
pub fn preview_release(
    state: State<'_, AppState>,
    input: PreviewReleaseCommandInput,
) -> AppResult<crate::releases::ReleasePlan> {
    actions::preview_release::execute(
        &state.sources,
        &state.scopes,
        &state.changes,
        actions::preview_release::PreviewReleaseInput {
            scope_id: input.scope_id,
            target: input.target,
            change_ids: input.change_ids,
        },
    )
}
