use crate::scopes::scope::SourceNodeRef;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceTreeNode {
    pub reference: SourceNodeRef,
    pub display_name: String,
    pub kind: String,
    pub selectable: bool,
    pub has_children: bool,
}
