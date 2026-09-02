use crate::changes::change::Change;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeSet {
    pub scope_id: String,
    pub scanned_at: String,
    pub changes: Vec<Change>,
}
