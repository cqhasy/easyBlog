use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{
    releases::{ContentHash, PlannedFile, PlannedFileContents},
    shared::errors::{AppError, AppResult},
    workspace::GitObjectStore,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Write,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OperationPrecondition {
    Absent,
    Matches(ContentHash),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseOperation {
    pub target_path: PathBuf,
    pub operation_kind: OperationKind,
    pub before_hash: Option<ContentHash>,
    pub after_hash: Option<ContentHash>,
    pub before_blob_sha: Option<String>,
    pub after_blob_sha: Option<String>,
}

impl ReleaseOperation {
    pub fn write(
        target_path: impl Into<PathBuf>,
        before_hash: Option<ContentHash>,
        after_hash: ContentHash,
        before_blob_sha: Option<String>,
    ) -> Self {
        Self {
            target_path: target_path.into(),
            operation_kind: OperationKind::Write,
            before_hash,
            after_hash: Some(after_hash),
            before_blob_sha,
            after_blob_sha: None,
        }
    }

    pub fn delete(
        target_path: impl Into<PathBuf>,
        before_hash: Option<ContentHash>,
        before_blob_sha: Option<String>,
    ) -> AppResult<Self> {
        let before_hash = before_hash.ok_or_else(|| {
            AppError::new(
                "release_delete_before_hash_missing",
                "A delete operation requires the recorded pre-publication content hash",
            )
        })?;
        let before_blob_sha = before_blob_sha.ok_or_else(|| {
            AppError::new(
                "release_delete_before_blob_missing",
                "A delete operation requires the recorded pre-publication Git blob",
            )
        })?;
        Ok(Self {
            target_path: target_path.into(),
            operation_kind: OperationKind::Delete,
            before_hash: Some(before_hash),
            after_hash: None,
            before_blob_sha: Some(before_blob_sha),
            after_blob_sha: None,
        })
    }

    pub fn before_precondition(&self) -> OperationPrecondition {
        match &self.before_hash {
            Some(hash) => OperationPrecondition::Matches(hash.clone()),
            None => OperationPrecondition::Absent,
        }
    }

    pub fn inverse(&self, objects: &GitObjectStore) -> AppResult<PlannedFile> {
        if self.operation_kind == OperationKind::Delete
            && (self.before_hash.is_none() || self.before_blob_sha.is_none())
        {
            return Err(AppError::new(
                "release_delete_before_data_missing",
                "A delete operation cannot be reversed without its recorded prior file",
            ));
        }
        match (&self.before_hash, &self.before_blob_sha) {
            (None, _) => Ok(PlannedFile {
                path: self.target_path.clone(),
                contents: PlannedFileContents::Delete,
            }),
            (Some(expected_hash), Some(blob_sha)) => {
                let blob = objects.blob_by_sha(blob_sha).map_err(|_| {
                    AppError::new(
                        "release_before_blob_unavailable",
                        "The recorded pre-publication file could not be read",
                    )
                })?;
                if ContentHash::from_bytes(&blob.bytes) != *expected_hash {
                    return Err(AppError::new(
                        "release_before_blob_mismatch",
                        "The recorded pre-publication file does not match its content hash",
                    ));
                }
                Ok(PlannedFile {
                    path: self.target_path.clone(),
                    contents: PlannedFileContents::Binary(blob.bytes),
                })
            }
            (Some(_), None) => Err(AppError::new(
                "release_before_blob_missing",
                "The recorded pre-publication file cannot be restored safely",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use super::*;
    use crate::{
        releases::{ContentHash, PlannedFileContents},
        workspace::GitObjectStore,
    };

    fn hash(contents: &[u8]) -> ContentHash {
        ContentHash::from_bytes(contents)
    }

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn inverse_delete_requires_the_recorded_before_blob() {
        let root =
            std::env::temp_dir().join(format!("easyblog-operation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let store = GitObjectStore::new(&root, "commit");
        let operation = ReleaseOperation {
            target_path: "_posts/old.md".into(),
            operation_kind: OperationKind::Delete,
            before_hash: Some(hash(b"old")),
            after_hash: None,
            before_blob_sha: None,
            after_blob_sha: None,
        };

        assert!(operation.inverse(&store).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_constructor_rejects_missing_before_hash_or_blob() {
        assert!(ReleaseOperation::delete("_posts/old.md", None, Some("blob".into())).is_err());
        assert!(ReleaseOperation::delete("_posts/old.md", Some(hash(b"old")), None).is_err());
    }

    #[test]
    fn inverse_write_deletes_a_new_file() {
        let root =
            std::env::temp_dir().join(format!("easyblog-operation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let store = GitObjectStore::new(&root, "commit");
        let operation = ReleaseOperation::write("_posts/new.md", None, hash(b"new"), None);

        let inverse = operation.inverse(&store).unwrap();

        assert_eq!(inverse.path, std::path::PathBuf::from("_posts/new.md"));
        assert_eq!(inverse.contents, PlannedFileContents::Delete);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inverse_restores_exact_before_blob_bytes() {
        let root =
            std::env::temp_dir().join(format!("easyblog-operation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        git(&root, &["init"]);
        fs::create_dir_all(root.join("_posts")).unwrap();
        fs::write(root.join("_posts/old.md"), b"old\0bytes").unwrap();
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
        let blob = GitObjectStore::blob_at_commit(&root, &commit, Path::new("_posts/old.md"))
            .unwrap()
            .unwrap();
        let operation = ReleaseOperation::write(
            "_posts/old.md",
            Some(hash(b"old\0bytes")),
            hash(b"new"),
            Some(blob.sha),
        );

        let inverse = operation
            .inverse(&GitObjectStore::new(&root, &commit))
            .unwrap();

        assert_eq!(
            inverse.contents,
            PlannedFileContents::Binary(b"old\0bytes".to_vec())
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inverse_delete_restores_the_recorded_binary_before_blob() {
        let root =
            std::env::temp_dir().join(format!("easyblog-operation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        git(&root, &["init"]);
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/cover.png"), b"cover\0bytes").unwrap();
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
        let blob = GitObjectStore::blob_at_commit(&root, &commit, Path::new("assets/cover.png"))
            .unwrap()
            .unwrap();
        let operation = ReleaseOperation::delete(
            "assets/cover.png",
            Some(hash(b"cover\0bytes")),
            Some(blob.sha),
        )
        .unwrap();

        let inverse = operation
            .inverse(&GitObjectStore::new(&root, &commit))
            .unwrap();

        assert_eq!(
            inverse.contents,
            PlannedFileContents::Binary(b"cover\0bytes".to_vec())
        );
        fs::remove_dir_all(root).unwrap();
    }
}
