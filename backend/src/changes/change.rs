use crate::tracking::snapshot::Snapshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Updated,
    Moved,
    Deleted,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Change {
    pub id: String,
    pub scope_id: String,
    pub kind: ChangeKind,
    pub source_identity: String,
    pub source_path: String,
    pub previous_path: Option<String>,
    pub title: Option<String>,
    pub selected: bool,
    pub blocked_reason: Option<String>,
    pub snapshot: Option<Snapshot>,
}
