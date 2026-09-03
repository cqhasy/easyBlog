use std::path::{Path, PathBuf};

use crate::shared::ids::TargetId;
use serde::{Deserialize, Serialize};

use super::layout::PagesLayout;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub id: TargetId,
    #[serde(skip_serializing)]
    pub workspace_path: PathBuf,
    pub repository: String,
    pub default_branch: String,
    pub visibility: TargetVisibility,
    pub state: TargetState,
    #[serde(default)]
    pub adapter: Option<PublishingAdapter>,
    #[serde(default)]
    pub layout: PagesLayout,
}

impl Target {
    pub fn new(id: impl Into<TargetId>, workspace_path: impl Into<PathBuf>) -> Self {
        Self {
            id: id.into(),
            workspace_path: workspace_path.into(),
            repository: "Legacy local repository".into(),
            default_branch: "".into(),
            visibility: TargetVisibility::Private,
            state: TargetState::NeedsReconnect,
            adapter: None,
            layout: PagesLayout::default(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.workspace_path
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishingAdapter {
    GithubPages,
    AstroContent,
}

impl PublishingAdapter {
    pub fn label(&self) -> &'static str {
        match self {
            Self::GithubPages => "GitHub Pages",
            Self::AstroContent => "Astro content collections",
        }
    }

    pub fn default_layout(&self) -> PagesLayout {
        match self {
            Self::GithubPages => PagesLayout::default(),
            Self::AstroContent => PagesLayout {
                posts_directory: "src/content/posts".into(),
                resources_directory: "src/assets/easyblog".into(),
            },
        }
    }

    pub fn configuration_path(&self) -> Option<&'static str> {
        match self {
            Self::GithubPages => Some(".github/easyblog.yml"),
            Self::AstroContent => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetVisibility {
    Public,
    Private,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetState {
    Ready,
    NeedsConfiguration,
    NeedsRecovery,
    NeedsReconnect,
}
