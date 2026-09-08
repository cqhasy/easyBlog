use crate::{
    providers::github::auth::{GithubAuth, GithubAuthError, GithubAuthStatus, GithubLoginStatus},
    shared::errors::{AppError, AppResult},
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GithubAuthorization {
    pub state: &'static str,
    pub login: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GithubLoginLaunch {
    pub state: &'static str,
    pub device_code: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GithubLoginProgress {
    pub state: &'static str,
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

pub fn start_login() -> AppResult<GithubLoginLaunch> {
    start_login_with(GithubAuth::start_login)
}

pub fn login_status() -> GithubLoginProgress {
    let state = match GithubAuth::login_status() {
        GithubLoginStatus::Pending => "pending",
        GithubLoginStatus::Ready => "ready",
        GithubLoginStatus::Failed => "failed",
    };
    GithubLoginProgress { state }
}

fn start_login_with(
    start: impl FnOnce() -> Result<String, GithubAuthError>,
) -> AppResult<GithubLoginLaunch> {
    let device_code = start().map_err(|error| match error {
        GithubAuthError::MissingCli => error_for_state("missing_cli"),
        GithubAuthError::LoginFailed => AppError::new(
            "github_login_failed",
            "GitHub authorization could not be started. Check GitHub CLI and try again.",
        ),
        GithubAuthError::GitCredentialSetupFailed => AppError::new(
            "github_git_credentials_failed",
            "GitHub is connected, but Git HTTPS credentials could not be prepared.",
        ),
    })?;
    Ok(GithubLoginLaunch {
        state: "started",
        device_code,
    })
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

#[cfg(test)]
mod tests {
    use super::{start_login_with, GithubAuthError, GithubLoginLaunch};

    #[test]
    fn acknowledges_a_started_login_without_checking_authorization() {
        let launch = start_login_with(|| Ok("534D-B889".into()))
            .expect("a device code should start GitHub authorization");

        assert_eq!(
            launch,
            GithubLoginLaunch {
                state: "started",
                device_code: "534D-B889".into(),
            }
        );
    }

    #[test]
    fn reports_a_missing_cli_when_login_cannot_start() {
        let error = start_login_with(|| Err(GithubAuthError::MissingCli))
            .expect_err("missing GitHub CLI should block authorization launch");

        assert_eq!(error.code, "github_cli_missing");
    }
}
