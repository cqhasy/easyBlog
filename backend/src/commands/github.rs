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
pub async fn start_github_login() -> AppResult<actions::github_auth::GithubLoginLaunch> {
    tauri::async_runtime::spawn_blocking(actions::github_auth::start_login)
        .await
        .map_err(|_| {
            AppError::new(
                "github_login_failed",
                "GitHub authorization could not be started",
            )
        })?
}

#[tauri::command]
pub async fn github_login_status() -> actions::github_auth::GithubLoginProgress {
    tauri::async_runtime::spawn_blocking(actions::github_auth::login_status)
        .await
        .unwrap_or(actions::github_auth::GithubLoginProgress { state: "failed" })
}
