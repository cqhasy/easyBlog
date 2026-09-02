use crate::{
    providers::github::auth::{GithubAuth, GithubAuthError, GithubAuthStatus},
    shared::errors::{AppError, AppResult},
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GithubAuthorization {
    pub state: &'static str,
    pub login: Option<String>,
}

pub fn status() -> GithubAuthorization {
    match GithubAuth::status() {
        GithubAuthStatus::Ready { login } => GithubAuthorization {
            state: "ready",
            login,
        },
        GithubAuthStatus::MissingCli => GithubAuthorization {
            state: "missing_cli",
            login: None,
        },
        GithubAuthStatus::Unauthenticated => GithubAuthorization {
            state: "unauthenticated",
            login: None,
        },
        GithubAuthStatus::Unavailable => GithubAuthorization {
            state: "unavailable",
            login: None,
        },
    }
}

pub fn require_ready() -> AppResult<GithubAuthorization> {
    let authorization = status();
    if authorization.state == "ready" {
        Ok(authorization)
    } else {
        Err(error_for_state(authorization.state))
    }
}

pub fn login() -> AppResult<GithubAuthorization> {
    GithubAuth::login().map_err(|error| match error {
        GithubAuthError::MissingCli => error_for_state("missing_cli"),
        GithubAuthError::LoginFailed => AppError::new(
            "github_login_failed",
            "GitHub authorization was not completed. Finish the GitHub CLI login and try again.",
        ),
        GithubAuthError::GitCredentialSetupFailed => AppError::new(
            "github_git_credentials_failed",
            "GitHub is connected, but Git HTTPS credentials could not be prepared.",
        ),
    })?;
    require_ready()
}

pub fn prepare_git_credentials() -> AppResult<()> {
    GithubAuth::setup_git_credentials().map_err(|error| match error {
        GithubAuthError::MissingCli => error_for_state("missing_cli"),
        GithubAuthError::LoginFailed | GithubAuthError::GitCredentialSetupFailed => AppError::new(
            "github_git_credentials_failed",
            "GitHub is connected, but Git HTTPS credentials could not be prepared.",
        ),
    })
}

fn error_for_state(state: &str) -> AppError {
    match state {
        "missing_cli" => AppError::new(
            "github_cli_missing",
            "Install GitHub CLI (gh) to connect GitHub publishing.",
        ),
        "unauthenticated" => AppError::new(
            "github_not_authenticated",
            "Connect GitHub before adding a publishing target.",
        ),
        _ => AppError::new(
            "github_auth_unavailable",
            "GitHub authorization could not be checked. Check your network and try again.",
        ),
    }
}
