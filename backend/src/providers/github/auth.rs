use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubAuthStatus {
    Ready { login: Option<String> },
    MissingCli,
    Unauthenticated,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubAuthError {
    MissingCli,
    LoginFailed,
    GitCredentialSetupFailed,
}

pub struct GithubAuth;

impl GithubAuth {
    pub fn status() -> GithubAuthStatus {
        let output = match Command::new("gh")
            .args(["auth", "status", "--hostname", "github.com"])
            .output()
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return GithubAuthStatus::MissingCli;
            }
            Err(_) => return GithubAuthStatus::Unavailable,
        };
        if output.status.success() {
            GithubAuthStatus::Ready {
                login: parse_login(&String::from_utf8_lossy(&output.stderr)),
            }
        } else {
            GithubAuthStatus::Unauthenticated
        }
    }

    pub fn login() -> Result<(), GithubAuthError> {
        let status = Command::new("gh")
            .args([
                "auth",
                "login",
                "--hostname",
                "github.com",
                "--web",
                "--clipboard",
                "--git-protocol",
                "https",
            ])
            .status()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    GithubAuthError::MissingCli
                } else {
                    GithubAuthError::LoginFailed
                }
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(GithubAuthError::LoginFailed)
        }
    }

    pub fn setup_git_credentials() -> Result<(), GithubAuthError> {
        let status = Command::new("gh")
            .args(["auth", "setup-git", "--hostname", "github.com"])
            .status()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    GithubAuthError::MissingCli
                } else {
                    GithubAuthError::GitCredentialSetupFailed
                }
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(GithubAuthError::GitCredentialSetupFailed)
        }
    }
}

fn parse_login(status: &str) -> Option<String> {
    let marker = "account ";
    let start = status.find(marker)? + marker.len();
    status[start..]
        .split_whitespace()
        .next()
        .map(|login| {
            login
                .trim_matches(|character| character == '(' || character == ')')
                .to_owned()
        })
        .filter(|login| !login.is_empty())
}

#[cfg(test)]
mod tests {
    use super::parse_login;

    #[test]
    fn extracts_the_cli_reported_account_without_retaining_other_output() {
        assert_eq!(
            parse_login("github.com\n  ✓ Logged in to github.com account octocat (keyring)\n"),
            Some("octocat".into())
        );
        assert_eq!(parse_login("not logged in"), None);
    }
}
