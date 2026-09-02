use std::{path::Path, process::Command};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: String,
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
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if output.status.success() {
            Ok(GitOutput { stdout, stderr })
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

    pub fn status_porcelain(root: &Path) -> Result<String, GitCommandError> {
        Ok(Self::run(root, &["status", "--porcelain=v1", "-z"])?.stdout)
    }
}
