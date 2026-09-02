use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileLockError {
    Busy { workspace: String },
    InvalidWorkspace { workspace: String },
}

fn locked_workspaces() -> &'static Mutex<HashSet<PathBuf>> {
    static LOCKS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub struct FileLock {
    workspace: PathBuf,
}

impl FileLock {
    pub fn acquire(workspace: &Path) -> Result<Self, FileLockError> {
        let workspace =
            std::fs::canonicalize(workspace).map_err(|_| FileLockError::InvalidWorkspace {
                workspace: workspace.display().to_string(),
            })?;
        let mut locks = locked_workspaces()
            .lock()
            .expect("workspace locks poisoned");
        if !locks.insert(workspace.clone()) {
            return Err(FileLockError::Busy {
                workspace: workspace.display().to_string(),
            });
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
    use std::{process::Command, time::Duration};

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

    #[cfg(unix)]
    #[test]
    fn distinguishes_non_utf8_canonical_workspace_paths() {
        use std::os::unix::ffi::OsStringExt;

        let root =
            std::env::temp_dir().join(format!("easyblog-workspace-lock-{}", uuid::Uuid::new_v4()));
        let first = root.join(std::ffi::OsString::from_vec(b"workspace-\xff".to_vec()));
        let second = root.join(std::ffi::OsString::from_vec(b"workspace-\xfe".to_vec()));
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir(&second).unwrap();

        let first_lock = FileLock::acquire(&first).unwrap();
        let second_lock = FileLock::acquire(&second).unwrap();
        drop(second_lock);
        drop(first_lock);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn releases_a_workspace_after_a_timed_process_is_reaped() {
        let directory = std::env::temp_dir().join(format!(
            "easyblog-workspace-timeout-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).unwrap();
        {
            let _lock = FileLock::acquire(&directory).unwrap();
            let mut command = if cfg!(windows) {
                let mut command = Command::new("powershell");
                command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"]);
                command
            } else {
                let mut command = Command::new("sh");
                command.args(["-c", "sleep 5"]);
                command
            };
            assert!(matches!(
                crate::providers::git::run_with_timeout(&mut command, Duration::from_millis(50)),
                Err(crate::providers::git::GitCommandError::TimedOut)
            ));
        }
        assert!(FileLock::acquire(&directory).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
