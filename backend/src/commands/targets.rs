use crate::{
    actions, app::state::AppState, shared::errors::AppResult, storage::targets::ConnectedTarget,
};
use tauri::State;

#[tauri::command]
pub fn connect_target(
    state: State<'_, AppState>,
    workspace_path: String,
    name: Option<String>,
) -> AppResult<ConnectedTarget> {
    actions::connect_target::execute(&state.targets, workspace_path, name)
}

#[tauri::command]
pub fn list_targets(state: State<'_, AppState>) -> AppResult<Vec<ConnectedTarget>> {
    actions::list_targets::execute(&state.targets)
}
