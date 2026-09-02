use serde::{Deserialize, Serialize};

use crate::shared::ids::{ChangeId, ReleaseBatchId, ScopeId, TargetId};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseBatch {
    pub id: ReleaseBatchId,
    pub scope_id: ScopeId,
    pub target_id: TargetId,
    pub change_ids: Vec<ChangeId>,
}
