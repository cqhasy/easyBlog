use serde::Serialize;

pub trait SourceReader {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub name: String,
    pub r#type: String,
    pub created_at: String,
}
