use std::{path::Path, process::Command};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubRemoteError {
    MissingOrigin,
    UnsupportedHost,
    SshProtocol,
    Unreadable,
}

pub struct GithubRemote;

impl GithubRemote {
    pub fn verify(root: &Path) -> Result<(), GithubRemoteError> {
        let output = Command::new("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(root)
            .output()
            .map_err(|_| GithubRemoteError::MissingOrigin)?;
        if !output.status.success() {
            return Err(GithubRemoteError::MissingOrigin);
        }
        let remote = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        validate_https_remote(&remote)?;
        let reachable = Command::new("git")
            .args(["ls-remote", "origin"])
            .current_dir(root)
            .output()
            .map_err(|_| GithubRemoteError::Unreadable)?;
        if reachable.status.success() {
            Ok(())
        } else {
            Err(GithubRemoteError::Unreadable)
        }
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
    use super::{validate_https_remote, GithubRemoteError};

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
}
