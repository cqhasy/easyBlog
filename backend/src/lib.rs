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
            let state = app::wiring::build_state(
                data_dir.join("easyblog.sqlite"),
                data_dir.join("workspaces"),
            )
            .map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            commands::github::github_authorization_status,
            commands::github::start_github_login,
            commands::sources::add_source,
            commands::sources::list_sources,
            commands::targets::connect_target,
            commands::targets::list_targets,
            commands::targets::inspect_target_configuration,
            commands::targets::save_target_configuration,
            commands::targets::preview_target_initialization,
            commands::targets::initialize_target,
            commands::targets::list_github_repositories,
            commands::targets::refresh_github_repository_permissions,
            commands::scopes::save_scope,
            commands::scopes::list_scopes,
            commands::scopes::set_scope_lifecycle,
            commands::scopes::get_source_children,
            commands::changes::scan_scope,
            commands::changes::list_changes,
            commands::releases::preview_release,
            commands::releases::publish_release,
            commands::history::list_publications,
            commands::history::retry_release,
            commands::history::rollback_publication
        ])
        .run(tauri::generate_context!())
        .expect("error while running easyBlog");
}
