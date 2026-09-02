use crate::actions;
use crate::app::state::AppState;
use crate::changes::change_set::ChangeSet;
use crate::shared::errors::{AppError, AppResult};
use tauri::State;

#[tauri::command]
pub fn scan_scope(state: State<'_, AppState>, scope_id: String) -> AppResult<ChangeSet> {
    actions::scan_scope::execute(
        &state.sources,
        &state.scopes,
        &state.snapshots,
        &state.changes,
        scope_id,
    )
}

#[tauri::command]
pub fn list_changes(
    state: State<'_, AppState>,
    scope_id: String,
) -> AppResult<Vec<crate::changes::change::Change>> {
    state
        .changes
        .list(&scope_id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))
}
