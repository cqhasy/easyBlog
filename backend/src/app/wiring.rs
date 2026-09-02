use super::state::AppState;
use std::path::Path;

pub fn build_state(db_path: impl AsRef<Path>) -> Result<AppState, rusqlite::Error> {
    AppState::open(db_path)
}
