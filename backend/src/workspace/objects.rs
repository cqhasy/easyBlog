use std::path::{Path, PathBuf};

use crate::providers::git::{GitCommandError, GitCommands};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitBlob {
    pub sha: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitObjectError {
    InvalidPath { path: PathBuf },
    Git(GitCommandError),
}

#[derive(Debug, Clone)]
pub struct GitObjectStore {
    root: PathBuf,
    commit_sha: String,
}

impl GitObjectStore {
    pub fn new(root: &Path, commit_sha: impl Into<String>) -> Self {
        Self {
            root: root.to_owned(),
            commit_sha: commit_sha.into(),
        }
    }

    pub fn blob_at_commit(
        root: &Path,
        commit_sha: &str,
        path: &Path,
    ) -> Result<Option<GitBlob>, GitObjectError> {
        let object = object_name(commit_sha, path)?;
        let arguments = ["show", object.as_str()];
        let output = match GitCommands::run(root, &arguments) {
            Ok(output) => output,
            Err(GitCommandError::Failed { stderr, .. }) if is_missing_path(&stderr) => {
                return Ok(None);
            }
            Err(error) => return Err(GitObjectError::Git(error)),
        };
        let sha = Self::blob_sha(root, &object)?;
        Ok(Some(GitBlob {
            sha,
            bytes: output.stdout,
        }))
    }

    pub fn blob_by_sha(&self, sha: &str) -> Result<GitBlob, GitObjectError> {
        let arguments = ["cat-file", "-p", sha];
        let output = GitCommands::run(&self.root, &arguments).map_err(GitObjectError::Git)?;
        Ok(GitBlob {
            sha: sha.to_owned(),
            bytes: output.stdout,
        })
    }

    pub fn blob_at_path(&self, path: &Path) -> Result<Option<GitBlob>, GitObjectError> {
        Self::blob_at_commit(&self.root, &self.commit_sha, path)
    }

    fn blob_sha(root: &Path, object: &str) -> Result<String, GitObjectError> {
        let arguments = ["rev-parse", "--verify", object];
        let output = GitCommands::run(root, &arguments).map_err(GitObjectError::Git)?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}

fn object_name(commit_sha: &str, path: &Path) -> Result<String, GitObjectError> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(GitObjectError::InvalidPath {
            path: path.to_owned(),
        });
    }
    let path = path.to_str().ok_or_else(|| GitObjectError::InvalidPath {
        path: path.to_owned(),
    })?;
    Ok(format!("{commit_sha}:{path}"))
}

fn is_missing_path(stderr: &str) -> bool {
    stderr.contains("does not exist in") || stderr.contains("exists on disk, but not in")
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use super::GitObjectStore;

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn reads_exact_blob_bytes_and_reports_missing_paths() {
        let root = std::env::temp_dir().join(format!("easyblog-objects-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        git(&root, &["init"]);
        fs::write(root.join("binary.bin"), b"zero\0byte").unwrap();
        git(&root, &["add", "."]);
        git(
            &root,
            &[
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "initial",
            ],
        );
        let commit = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&root)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_owned();

        let blob = GitObjectStore::blob_at_commit(&root, &commit, Path::new("binary.bin"))
            .unwrap()
            .unwrap();

        assert_eq!(blob.bytes, b"zero\0byte");
        assert!(
            GitObjectStore::blob_at_commit(&root, &commit, Path::new("missing.bin"))
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
