use serde::{Deserialize, Serialize};

/// Metadata-only representation of an article observed during a scope scan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub scope_id: String,
    pub source_identity: String,
    pub source_path: String,
    pub title: Option<String>,
    pub fingerprint: String,
    pub observed_at: String,
}
