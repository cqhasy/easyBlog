use crate::shared::ids::{ScopeId, SourceId, TargetId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeLifecycle {
    Active,
    Paused,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeHealth {
    Ready,
    NeedsTarget,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceNodeRef {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeSelection {
    pub node: SourceNodeRef,
    pub recursive: bool,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scope {
    pub id: ScopeId,
    pub source_id: SourceId,
    pub target_id: Option<TargetId>,
    pub name: String,
    pub lifecycle: ScopeLifecycle,
    pub revision: i64,
    pub selections: Vec<ScopeSelection>,
    pub include_patterns: Vec<String>,
    pub exclude_patterns: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeDiagnostic {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeSummary {
    pub scope: Scope,
    pub health: ScopeHealth,
    pub diagnostics: Vec<ScopeDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SaveScopeInput {
    pub id: Option<ScopeId>,
    pub source_id: SourceId,
    pub target_id: Option<TargetId>,
    pub name: String,
    pub lifecycle: ScopeLifecycle,
    pub selections: Vec<ScopeSelection>,
    pub include_patterns: Vec<String>,
    pub exclude_patterns: Vec<String>,
}
