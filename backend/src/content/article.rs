use std::collections::BTreeMap;

use super::{ConversionWarning, Markdown, ResourceReference};

/// Source-independent content ready for change detection and target adaptation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Article {
    pub source_identity: String,
    pub title: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub markdown: Markdown,
    pub resources: Vec<ResourceReference>,
    pub warnings: Vec<ConversionWarning>,
}
