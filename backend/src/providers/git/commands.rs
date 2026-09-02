use std::{path::Path, process::Command};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCommandError {
    Unavailable,
    Failed {
        arguments: Vec<String>,
        stderr: String,
    },
}

pub struct GitCommands;

impl GitCommands {
    pub fn run(root: &Path, arguments: &[&str]) -> Result<GitOutput, GitCommandError> {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .map_err(|_| GitCommandError::Unavailable)?;
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if output.status.success() {
            Ok(GitOutput {
                stdout: output.stdout,
                stderr,
            })
        } else {
            Err(GitCommandError::Failed {
                arguments: arguments
                    .iter()
                    .map(|argument| (*argument).into())
                    .collect(),
                stderr,
            })
        }
    }

    pub fn status_porcelain(root: &Path) -> Result<Vec<u8>, GitCommandError> {
        Ok(Self::run(root, &["status", "--porcelain=v1", "-z"])?.stdout)
    }

    pub fn commit_sha(root: &Path) -> Result<String, GitCommandError> {
        let output = Self::run(root, &["rev-parse", "HEAD"])?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}
