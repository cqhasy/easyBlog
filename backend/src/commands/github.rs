use crate::{
    actions,
    shared::errors::{AppError, AppResult},
};

#[tauri::command]
pub async fn github_authorization_status() -> actions::github_auth::GithubAuthorization {
    tauri::async_runtime::spawn_blocking(actions::github_auth::status)
        .await
        .unwrap_or(actions::github_auth::GithubAuthorization {
            state: "unavailable",
            login: None,
        })
}

#[tauri::command]
pub async fn start_github_login() -> AppResult<actions::github_auth::GithubAuthorization> {
    tauri::async_runtime::spawn_blocking(actions::github_auth::login)
        .await
        .map_err(|_| {
            AppError::new(
                "github_login_failed",
                "GitHub authorization could not be started",
            )
        })?
}
