use std::{
    collections::HashSet,
    path::Path,
    sync::{Mutex, OnceLock},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileLockError {
    Busy { workspace: String },
    InvalidWorkspace { workspace: String },
}

fn locked_workspaces() -> &'static Mutex<HashSet<String>> {
    static LOCKS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub struct FileLock {
    workspace: String,
}

impl FileLock {
    pub fn acquire(workspace: &Path) -> Result<Self, FileLockError> {
        let workspace = std::fs::canonicalize(workspace)
            .map_err(|_| FileLockError::InvalidWorkspace {
                workspace: workspace.display().to_string(),
            })?
            .display()
            .to_string();
        let mut locks = locked_workspaces()
            .lock()
            .expect("workspace locks poisoned");
        if !locks.insert(workspace.clone()) {
            return Err(FileLockError::Busy { workspace });
        }
        Ok(Self { workspace })
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        if let Ok(mut locks) = locked_workspaces().lock() {
            locks.remove(&self.workspace);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_second_lock_until_the_first_is_released() {
        let directory =
            std::env::temp_dir().join(format!("easyblog-workspace-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let lock = FileLock::acquire(&directory).unwrap();
        assert!(matches!(
            FileLock::acquire(&directory),
            Err(FileLockError::Busy { .. })
        ));
        drop(lock);
        assert!(FileLock::acquire(&directory).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
