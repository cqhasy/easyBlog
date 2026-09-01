use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetadata {
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub readonly: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFile {
    pub relative_path: PathBuf,
    pub metadata: FileMetadata,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalFileTree {
    pub relative_path: PathBuf,
    pub metadata: FileMetadata,
    pub children: Vec<LocalFileTree>,
}
