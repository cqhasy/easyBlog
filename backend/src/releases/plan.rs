use crate::{
    releases::{FileSet, PlannedFileContents, ReleaseBatch},
    shared::errors::{AppError, AppResult},
    workspace::FileDiff,
};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReleasePlan {
    pub preview_id: String,
    pub batch: ReleaseBatch,
    pub status: ReleasePreviewStatus,
    pub needs_configuration: bool,
    pub diffs: Vec<FileDiff>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleasePreviewStatus {
    AwaitingConfirmation,
}

impl ReleasePlan {
    pub fn new(
        preview_id: impl Into<String>,
        batch: ReleaseBatch,
        needs_configuration: bool,
        files: &FileSet,
        root: &std::path::Path,
    ) -> AppResult<Self> {
        let diffs = files
            .files()
            .iter()
            .map(|file| match &file.contents {
                PlannedFileContents::Binary(contents) => Ok(crate::workspace::FileDiff {
                    path: file.path.clone(),
                    kind: if root.join(&file.path).exists() {
                        crate::workspace::FileChangeKind::Modified
                    } else {
                        crate::workspace::FileChangeKind::Added
                    },
                    patch: format!("Binary file ({} bytes)\n", contents.len()),
                }),
                PlannedFileContents::Text(contents) => {
                    let before = read_target_text(root, &file.path)?;
                    Ok(crate::workspace::Diff::text(
                        file.path.clone(),
                        before.as_deref(),
                        Some(contents),
                    ))
                }
                PlannedFileContents::Delete => {
                    let before = read_target_text(root, &file.path)?;
                    Ok(crate::workspace::Diff::text(
                        file.path.clone(),
                        before.as_deref(),
                        None,
                    ))
                }
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(Self {
            preview_id: preview_id.into(),
            batch,
            status: ReleasePreviewStatus::AwaitingConfirmation,
            needs_configuration,
            diffs,
        })
    }
}

fn read_target_text(root: &std::path::Path, path: &std::path::Path) -> AppResult<Option<String>> {
    match std::fs::read_to_string(root.join(path)) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(AppError::new(
            "target_file_unreadable",
            "An existing target file cannot be read for preview",
        )),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::releases::{FileSet, PlannedFile, PlannedFileContents, ReleaseBatch};

    use super::ReleasePlan;

    #[test]
    fn rejects_existing_target_paths_that_cannot_be_read_as_text() {
        let root = std::env::temp_dir().join(format!("easyblog-plan-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("_posts/hello.md")).unwrap();
        let mut files = FileSet::default();
        files
            .insert(PlannedFile {
                path: "_posts/hello.md".into(),
                contents: PlannedFileContents::Text("# Hello\n".into()),
            })
            .unwrap();

        let error = ReleasePlan::new(
            "preview",
            ReleaseBatch {
                id: "batch".into(),
                scope_id: "scope".into(),
                target_id: "target".into(),
                change_ids: vec!["change".into()],
            },
            false,
            &files,
            &root,
        )
        .unwrap_err();

        assert_eq!(error.code, "target_file_unreadable");
        fs::remove_dir_all(root).unwrap();
    }
}
