use crate::actions::configure_scope;
use crate::app::state::AppState;
use crate::providers::local::reader::LocalReader;
use crate::scopes::scope::{SaveScopeInput, ScopeLifecycle, ScopeSummary, SourceNodeRef};
use crate::shared::errors::{AppError, AppResult};
use crate::sources::tree::SourceTreeNode;
use tauri::State;

#[tauri::command]
pub fn save_scope(
    state: State<'_, AppState>,
    input: SaveScopeInput,
    expected_revision: Option<i64>,
) -> AppResult<ScopeSummary> {
    configure_scope::save(&state.sources, &state.scopes, input, expected_revision)
}

#[tauri::command]
pub fn list_scopes(
    state: State<'_, AppState>,
    source_id: Option<String>,
) -> AppResult<Vec<ScopeSummary>> {
    configure_scope::list(&state.scopes, source_id)
}

#[tauri::command]
pub fn set_scope_lifecycle(
    state: State<'_, AppState>,
    scope_id: String,
    lifecycle: ScopeLifecycle,
    expected_revision: i64,
) -> AppResult<ScopeSummary> {
    configure_scope::set_lifecycle(&state.scopes, scope_id, lifecycle, expected_revision)
}

#[tauri::command]
pub fn get_source_children(
    state: State<'_, AppState>,
    source_id: String,
    parent: Option<SourceNodeRef>,
) -> AppResult<Vec<SourceTreeNode>> {
    let source = state
        .sources
        .get(&source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .ok_or_else(|| AppError::new("source_not_found", "Source no longer exists"))?;
    if parent
        .as_ref()
        .is_some_and(|node| node.kind != "local_path")
    {
        return Err(AppError::new(
            "invalid_scope_selection",
            "Unsupported source node",
        ));
    }
    LocalReader::new(source.path)
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be read"))?
        .children(parent.as_ref().map(|node| node.value.as_str()))
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be read"))
}
