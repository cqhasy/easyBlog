use crate::actions;
use crate::app::state::AppState;
use crate::shared::errors::AppResult;
use crate::sources::source::Source;
use tauri::State;

#[tauri::command]
pub fn add_source(
    state: State<'_, AppState>,
    path: String,
    name: Option<String>,
) -> AppResult<Source> {
    actions::add_source::execute(&state.sources, path, name)
}

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> AppResult<Vec<Source>> {
    actions::list_sources::execute(&state.sources)
}
