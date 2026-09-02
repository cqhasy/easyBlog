use tauri::Manager;

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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let state = app::wiring::build_state(data_dir.join("easyblog.sqlite"))
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            commands::sources::add_source,
            commands::sources::list_sources
        ])
        .run(tauri::generate_context!())
        .expect("error while running easyBlog");
}
