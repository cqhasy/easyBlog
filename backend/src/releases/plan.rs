use crate::{
    releases::{FileSet, PlannedFileContents, ReleaseBatch},
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
    ) -> Self {
        let diffs = files
            .files()
            .iter()
            .map(|file| match &file.contents {
                PlannedFileContents::Binary(contents) => crate::workspace::FileDiff {
                    path: file.path.clone(),
                    kind: if root.join(&file.path).exists() {
                        crate::workspace::FileChangeKind::Modified
                    } else {
                        crate::workspace::FileChangeKind::Added
                    },
                    patch: format!("Binary file ({} bytes)\n", contents.len()),
                },
                PlannedFileContents::Text(contents) => {
                    let before = std::fs::read_to_string(root.join(&file.path)).ok();
                    crate::workspace::Diff::text(
                        file.path.clone(),
                        before.as_deref(),
                        Some(contents),
                    )
                }
                PlannedFileContents::Delete => {
                    let before = std::fs::read_to_string(root.join(&file.path)).ok();
                    crate::workspace::Diff::text(file.path.clone(), before.as_deref(), None)
                }
            })
            .collect();
        Self {
            preview_id: preview_id.into(),
            batch,
            status: ReleasePreviewStatus::AwaitingConfirmation,
            needs_configuration,
            diffs,
        }
    }
}
