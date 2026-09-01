pub mod actions;
pub mod app;
pub mod changes;
pub mod commands;
pub mod content;
pub mod credentials;
pub mod diagnostics;
pub mod providers;
pub mod releases;
pub mod scheduler;
pub mod scopes;
pub mod shared;
pub mod sources;
pub mod storage;
pub mod targets;
pub mod tracking;
pub mod workspace;

#[tauri::command]
fn health() -> &'static str {
    "easyBlog backend ready"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![health])
        .run(tauri::generate_context!())
        .expect("error while running easyBlog");
}
