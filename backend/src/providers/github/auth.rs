use std::{io, process::Command};

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

const GITHUB_LOGIN_ARGUMENTS: [&str; 7] = [
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--web",
    "--git-protocol",
    "https",
];

trait GithubLoginLauncher {
    fn launch(&self, arguments: &[&str]) -> io::Result<()>;
}

struct SystemGithubLoginLauncher;

impl GithubLoginLauncher for SystemGithubLoginLauncher {
    fn launch(&self, arguments: &[&str]) -> io::Result<()> {
        Command::new("gh").args(arguments).spawn().map(|_child| ())
    }
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

    pub fn start_login() -> Result<(), GithubAuthError> {
        start_login_with(&SystemGithubLoginLauncher)
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

fn start_login_with(launcher: &impl GithubLoginLauncher) -> Result<(), GithubAuthError> {
    launcher.launch(&GITHUB_LOGIN_ARGUMENTS).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            GithubAuthError::MissingCli
        } else {
            GithubAuthError::LoginFailed
        }
    })
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
    use std::{cell::RefCell, io};

    use super::{parse_login, start_login_with, GithubAuthError, GithubLoginLauncher};

    #[derive(Default)]
    struct FakeGithubLoginLauncher {
        launches: RefCell<Vec<Vec<String>>>,
        failure: Option<io::ErrorKind>,
    }

    impl FakeGithubLoginLauncher {
        fn with_failure(failure: io::ErrorKind) -> Self {
            Self {
                launches: RefCell::default(),
                failure: Some(failure),
            }
        }
    }

    impl GithubLoginLauncher for FakeGithubLoginLauncher {
        fn launch(&self, arguments: &[&str]) -> io::Result<()> {
            self.launches.borrow_mut().push(
                arguments
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
            );
            match self.failure {
                Some(kind) => Err(io::Error::from(kind)),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn extracts_the_cli_reported_account_without_retaining_other_output() {
        assert_eq!(
            parse_login("github.com\n  ✓ Logged in to github.com account octocat (keyring)\n"),
            Some("octocat".into())
        );
        assert_eq!(parse_login("not logged in"), None);
    }

    #[test]
    fn starts_the_browser_authorization_without_clipboard_mode() {
        let launcher = FakeGithubLoginLauncher::default();

        assert_eq!(start_login_with(&launcher), Ok(()));
        assert_eq!(
            *launcher.launches.borrow(),
            vec![vec![
                "auth".to_owned(),
                "login".to_owned(),
                "--hostname".to_owned(),
                "github.com".to_owned(),
                "--web".to_owned(),
                "--git-protocol".to_owned(),
                "https".to_owned(),
            ]]
        );
    }

    #[test]
    fn reports_a_missing_github_cli_when_login_cannot_start() {
        let launcher = FakeGithubLoginLauncher::with_failure(io::ErrorKind::NotFound);

        assert_eq!(
            start_login_with(&launcher),
            Err(GithubAuthError::MissingCli)
        );
    }
}
