use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::releases::ContentHash;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingState {
    Active,
    Deleted,
    NeedsReconciliation,
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingRevisionState {
    Active,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BindingOutputKind {
    Article,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArticleBinding {
    pub id: String,
    pub target_id: String,
    pub scope_id: String,
    pub source_identity: String,
    pub state: BindingState,
    pub current_revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingRevision {
    pub id: String,
    pub binding_id: String,
    pub revision_number: i64,
    pub state: BindingRevisionState,
    pub outputs: Vec<BindingOutput>,
}

impl BindingRevision {
    pub fn deleted(
        id: String,
        binding_id: String,
        revision_number: i64,
        outputs: Vec<BindingOutput>,
    ) -> Self {
        Self {
            id,
            binding_id,
            revision_number,
            state: BindingRevisionState::Deleted,
            outputs,
        }
    }

    pub fn owns_live_outputs(&self) -> bool {
        self.state == BindingRevisionState::Active
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingOutput {
    pub target_path: PathBuf,
    pub content_hash: ContentHash,
    pub git_blob_sha: Option<String>,
    pub kind: BindingOutputKind,
}

impl BindingOutput {
    pub fn article(
        target_path: PathBuf,
        content_hash: ContentHash,
        git_blob_sha: impl Into<String>,
    ) -> Self {
        Self::new(
            target_path,
            content_hash,
            git_blob_sha,
            BindingOutputKind::Article,
        )
    }

    pub fn resource(
        target_path: PathBuf,
        content_hash: ContentHash,
        git_blob_sha: impl Into<String>,
    ) -> Self {
        Self::new(
            target_path,
            content_hash,
            git_blob_sha,
            BindingOutputKind::Resource,
        )
    }

    fn new(
        target_path: PathBuf,
        content_hash: ContentHash,
        git_blob_sha: impl Into<String>,
        kind: BindingOutputKind,
    ) -> Self {
        Self {
            target_path,
            content_hash,
            git_blob_sha: Some(git_blob_sha.into()),
            kind,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BindingTransition {
    pub binding_id: String,
    pub before_revision_id: Option<String>,
    pub after_revision_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::releases::ContentHash;

    #[test]
    fn deleted_outputs_remain_historical_but_not_live_owned() {
        let output = BindingOutput::resource(
            PathBuf::from("assets/easyblog/post/cover.png"),
            ContentHash::from_bytes(b"cover"),
            "blob",
        );
        let revision =
            BindingRevision::deleted("revision".into(), "binding".into(), 2, vec![output]);

        assert!(!revision.owns_live_outputs());
        assert_eq!(revision.outputs.len(), 1);
    }
}
