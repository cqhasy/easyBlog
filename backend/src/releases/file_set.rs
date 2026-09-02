use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlannedFileContents {
    Text(String),
    Binary(Vec<u8>),
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    pub path: PathBuf,
    pub contents: PlannedFileContents,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FileSet {
    files: Vec<PlannedFile>,
}

impl FileSet {
    pub fn insert(&mut self, file: PlannedFile) -> Result<(), FileSetError> {
        if self.files.iter().any(|existing| existing.path == file.path) {
            return Err(FileSetError::DuplicatePath {
                path: file.path.display().to_string(),
            });
        }
        self.files.push(file);
        self.files.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(())
    }
    pub fn files(&self) -> &[PlannedFile] {
        &self.files
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileSetError {
    DuplicatePath { path: String },
}
