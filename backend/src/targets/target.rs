use std::path::{Path, PathBuf};

use crate::shared::ids::TargetId;
use serde::{Deserialize, Serialize};

use super::layout::PagesLayout;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    pub id: TargetId,
    pub workspace_path: PathBuf,
    #[serde(default)]
    pub layout: PagesLayout,
}

impl Target {
    pub fn new(id: impl Into<TargetId>, workspace_path: impl Into<PathBuf>) -> Self {
        Self {
            id: id.into(),
            workspace_path: workspace_path.into(),
            layout: PagesLayout::default(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.workspace_path
    }
}
