use std::path::Path;

use crate::providers::git::{GitCommandError, GitCommands};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubRemoteError {
    MissingOrigin,
    UnsupportedHost,
    SshProtocol,
    Unreadable,
    TimedOut,
}

pub struct GithubRemote;

impl GithubRemote {
    pub fn verify(root: &Path) -> Result<(), GithubRemoteError> {
        let output = GitCommands::run_output(root, &["remote", "get-url", "origin"])
            .map_err(map_get_url_error)?;
        if !output.status.success() {
            return Err(GithubRemoteError::MissingOrigin);
        }
        let remote = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        validate_https_remote(&remote)?;
        let reachable =
            GitCommands::run_output(root, &["ls-remote", "origin"]).map_err(map_ls_remote_error)?;
        if reachable.status.success() {
            Ok(())
        } else {
            Err(GithubRemoteError::Unreadable)
        }
    }
}

fn map_get_url_error(error: GitCommandError) -> GithubRemoteError {
    match error {
        GitCommandError::TimedOut => GithubRemoteError::TimedOut,
        _ => GithubRemoteError::MissingOrigin,
    }
}

fn map_ls_remote_error(error: GitCommandError) -> GithubRemoteError {
    match error {
        GitCommandError::TimedOut => GithubRemoteError::TimedOut,
        _ => GithubRemoteError::Unreadable,
    }
}

fn validate_https_remote(remote: &str) -> Result<(), GithubRemoteError> {
    if remote.starts_with("git@") || remote.starts_with("ssh://") {
        return Err(GithubRemoteError::SshProtocol);
    }
    let Some(without_protocol) = remote.strip_prefix("https://") else {
        return Err(GithubRemoteError::UnsupportedHost);
    };
    if without_protocol.starts_with("github.com/") && without_protocol.len() > "github.com/".len() {
        Ok(())
    } else {
        Err(GithubRemoteError::UnsupportedHost)
    }
}

#[cfg(test)]
mod tests {
    use crate::providers::git::GitCommandError;

    use super::{map_get_url_error, map_ls_remote_error, validate_https_remote, GithubRemoteError};

    #[test]
    fn accepts_only_github_com_https_repository_remotes() {
        assert_eq!(
            validate_https_remote("https://github.com/octocat/blog.git"),
            Ok(())
        );
        assert_eq!(
            validate_https_remote("git@github.com:octocat/blog.git"),
            Err(GithubRemoteError::SshProtocol)
        );
        assert_eq!(
            validate_https_remote("https://github.example.com/octocat/blog.git"),
            Err(GithubRemoteError::UnsupportedHost)
        );
    }

    #[test]
    fn preserves_git_timeouts() {
        assert_eq!(
            map_get_url_error(GitCommandError::TimedOut),
            GithubRemoteError::TimedOut
        );
        assert_eq!(
            map_ls_remote_error(GitCommandError::TimedOut),
            GithubRemoteError::TimedOut
        );
    }
}
