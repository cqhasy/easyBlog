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
    NotBlob { path: PathBuf, object_type: String },
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
        let path = checked_path(path)?;
        let Some((object_type, sha)) = Self::tree_entry(root, commit_sha, path)? else {
            return Ok(None);
        };
        if object_type != "blob" {
            return Err(GitObjectError::NotBlob {
                path: path.to_owned(),
                object_type,
            });
        }
        Self::blob_by_sha_at(root, &sha).map(Some)
    }

    pub fn blob_by_sha(&self, sha: &str) -> Result<GitBlob, GitObjectError> {
        Self::blob_by_sha_at(&self.root, sha)
    }

    fn blob_by_sha_at(root: &Path, sha: &str) -> Result<GitBlob, GitObjectError> {
        let arguments = ["cat-file", "blob", sha];
        let output = GitCommands::run(root, &arguments).map_err(GitObjectError::Git)?;
        Ok(GitBlob {
            sha: sha.to_owned(),
            bytes: output.stdout,
        })
    }

    pub fn blob_at_path(&self, path: &Path) -> Result<Option<GitBlob>, GitObjectError> {
        Self::blob_at_commit(&self.root, &self.commit_sha, path)
    }

    fn tree_entry(
        root: &Path,
        commit_sha: &str,
        path: &Path,
    ) -> Result<Option<(String, String)>, GitObjectError> {
        let path_text = path.to_str().expect("checked path is UTF-8");
        let arguments = ["ls-tree", "-z", commit_sha, "--", path_text];
        let output = GitCommands::run(root, &arguments).map_err(GitObjectError::Git)?;
        let Some(entry) = output
            .stdout
            .split(|byte| *byte == 0)
            .find(|entry| !entry.is_empty())
        else {
            return Ok(None);
        };
        let header = entry
            .splitn(2, |byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let mut fields = header.split(|byte| *byte == b' ');
        let _mode = fields.next();
        let object_type = fields.next();
        let sha = fields.next();
        match (object_type, sha) {
            (Some(object_type), Some(sha)) => Ok(Some((
                String::from_utf8_lossy(object_type).into_owned(),
                String::from_utf8_lossy(sha).into_owned(),
            ))),
            _ => Err(GitObjectError::Git(GitCommandError::Failed {
                arguments: arguments
                    .iter()
                    .map(|argument| (*argument).to_owned())
                    .collect(),
                stderr: "git ls-tree returned an invalid tree entry".into(),
            })),
        }
    }
}

fn checked_path(path: &Path) -> Result<&Path, GitObjectError> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(GitObjectError::InvalidPath {
            path: path.to_owned(),
        });
    }
    path.to_str().ok_or_else(|| GitObjectError::InvalidPath {
        path: path.to_owned(),
    })?;
    Ok(path)
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

    #[test]
    fn rejects_tree_paths_instead_of_wrapping_them_as_blobs() {
        let root = std::env::temp_dir().join(format!("easyblog-objects-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        git(&root, &["init"]);
        fs::create_dir_all(root.join("directory")).unwrap();
        fs::write(root.join("directory/file.txt"), "contents").unwrap();
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

        assert!(GitObjectStore::blob_at_commit(&root, &commit, Path::new("directory")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
