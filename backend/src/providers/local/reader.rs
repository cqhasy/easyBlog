use std::fs;
use std::path::Path;

use super::file_tree::{FileMetadata, LocalFile, LocalFileTree};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalReadError {
    RootNotDirectory,
    Io(String),
    InvalidPath,
    NotFound,
    NonUtf8,
}

#[derive(Debug, Clone)]
pub struct LocalReader {
    root: std::path::PathBuf,
}

impl LocalReader {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, LocalReadError> {
        let root = fs::canonicalize(root).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                LocalReadError::NotFound
            } else {
                LocalReadError::Io(e.to_string())
            }
        })?;
        if !root.is_dir() {
            return Err(LocalReadError::RootNotDirectory);
        }
        Ok(Self { root })
    }

    /// Returns the metadata-only tree. Use `list_markdown` or `read_file` for contents.
    pub fn read_directory(&self) -> Result<LocalFileTree, LocalReadError> {
        self.read_tree(&self.root, std::path::PathBuf::new())
    }

    /// Returns Markdown files with their metadata and UTF-8 contents.
    pub fn list_markdown(&self) -> Result<Vec<LocalFile>, LocalReadError> {
        let mut files = Vec::new();
        self.collect_markdown(&self.root, &mut files)?;
        files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(files)
    }

    pub fn read_file(&self, relative_path: &Path) -> Result<LocalFile, LocalReadError> {
        let path = self.resolve_path(relative_path)?;
        let metadata = self.metadata(&path)?;
        if metadata.0.is_dir() {
            return Err(LocalReadError::InvalidPath);
        }
        let content = fs::read_to_string(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::InvalidData {
                LocalReadError::NonUtf8
            } else {
                LocalReadError::Io(e.to_string())
            }
        })?;
        Ok(LocalFile {
            relative_path: relative_path.to_path_buf(),
            metadata: metadata.1,
            content,
        })
    }

    fn resolve_path(&self, relative_path: &Path) -> Result<std::path::PathBuf, LocalReadError> {
        if relative_path.is_absolute()
            || relative_path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(LocalReadError::InvalidPath);
        }
        let path = self.root.join(relative_path);
        let canonical = fs::canonicalize(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                LocalReadError::NotFound
            } else {
                LocalReadError::Io(e.to_string())
            }
        })?;
        if !canonical.starts_with(&self.root) {
            return Err(LocalReadError::InvalidPath);
        }
        Ok(canonical)
    }

    fn metadata(&self, path: &Path) -> Result<(std::fs::Metadata, FileMetadata), LocalReadError> {
        let raw = fs::metadata(path).map_err(|e| LocalReadError::Io(e.to_string()))?;
        let metadata = FileMetadata {
            is_dir: raw.is_dir(),
            size: raw.len(),
            modified: raw.modified().ok(),
            readonly: raw.permissions().readonly(),
        };
        Ok((raw, metadata))
    }

    fn read_tree(
        &self,
        path: &Path,
        relative_path: std::path::PathBuf,
    ) -> Result<LocalFileTree, LocalReadError> {
        let (_, metadata) = self.metadata(path)?;
        let mut children = Vec::new();
        if path.is_dir() {
            let mut entries = fs::read_dir(path)
                .map_err(|e| LocalReadError::Io(e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| LocalReadError::Io(e.to_string()))?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                if entry
                    .file_type()
                    .map_err(|e| LocalReadError::Io(e.to_string()))?
                    .is_symlink()
                {
                    continue;
                }
                let child_relative = relative_path.join(entry.file_name());
                let child = self.resolve_path(&child_relative)?;
                children.push(self.read_tree(&child, child_relative)?);
            }
        }
        Ok(LocalFileTree {
            relative_path,
            metadata,
            children,
        })
    }

    fn collect_markdown(
        &self,
        path: &Path,
        files: &mut Vec<LocalFile>,
    ) -> Result<(), LocalReadError> {
        let mut entries = fs::read_dir(path)
            .map_err(|e| LocalReadError::Io(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| LocalReadError::Io(e.to_string()))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if entry
                .file_type()
                .map_err(|e| LocalReadError::Io(e.to_string()))?
                .is_symlink()
            {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&self.root)
                .map_err(|_| LocalReadError::InvalidPath)?
                .to_path_buf();
            let resolved = self.resolve_path(&relative)?;
            if resolved.is_dir() {
                self.collect_markdown(&resolved, files)?;
            } else if matches!(
                relative
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase())
                    .as_deref(),
                Some("md" | "markdown")
            ) {
                files.push(self.read_file(&relative)?);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("easyblog-local-reader-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn lists_markdown_recursively_and_case_insensitively() {
        let root = temp_root();
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("README.MD"), "# readme").unwrap();
        fs::write(root.join("nested/article.markdown"), "# article").unwrap();
        fs::write(root.join("nested/notes.txt"), "ignore").unwrap();

        let reader = LocalReader::new(&root).unwrap();
        let files = reader.list_markdown().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0].relative_path,
            std::path::PathBuf::from("README.MD")
        );
        assert_eq!(
            files[1].relative_path,
            std::path::PathBuf::from("nested/article.markdown")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_content_and_metadata() {
        let root = temp_root();
        fs::write(root.join("article.md"), "hello").unwrap();
        let reader = LocalReader::new(&root).unwrap();
        let file = reader.read_file(Path::new("article.md")).unwrap();
        assert_eq!(file.content, "hello");
        assert_eq!(file.metadata.size, 5);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_root() {
        let root = temp_root();
        let reader = LocalReader::new(&root).unwrap();
        assert_eq!(
            reader.read_file(Path::new("../outside.md")),
            Err(LocalReadError::InvalidPath)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_absolute_paths_and_non_utf8_content() {
        let root = temp_root();
        fs::write(root.join("binary.md"), [0xff, 0xfe]).unwrap();
        let reader = LocalReader::new(&root).unwrap();
        assert_eq!(
            reader.read_file(&root.join("binary.md")),
            Err(LocalReadError::InvalidPath)
        );
        assert_eq!(
            reader.read_file(Path::new("binary.md")),
            Err(LocalReadError::NonUtf8)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn returns_directory_tree_in_stable_order() {
        let root = temp_root();
        fs::create_dir_all(root.join("b")).unwrap();
        fs::write(root.join("z.txt"), "z").unwrap();
        fs::write(root.join("a.md"), "a").unwrap();
        fs::write(root.join("b/c.md"), "c").unwrap();
        let tree = LocalReader::new(&root).unwrap().read_directory().unwrap();
        assert_eq!(tree.children[0].relative_path, Path::new("a.md"));
        assert_eq!(tree.children[1].relative_path, Path::new("b"));
        assert_eq!(tree.children[2].relative_path, Path::new("z.txt"));
        fs::remove_dir_all(root).unwrap();
    }
}
