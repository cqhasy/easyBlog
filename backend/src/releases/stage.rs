use std::{fs, path::Path};

use crate::{
    releases::{FileSet, PlannedFileContents},
    shared::errors::{AppError, AppResult},
};

pub fn apply(root: &Path, files: &FileSet) -> AppResult<()> {
    for file in files.files() {
        let path = root.join(&file.path);
        match &file.contents {
            PlannedFileContents::Text(contents) => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|_| {
                        AppError::new(
                            "workspace_write_failed",
                            "The target workspace could not be prepared",
                        )
                    })?;
                }
                fs::write(path, contents).map_err(|_| {
                    AppError::new(
                        "workspace_write_failed",
                        "A target file could not be written",
                    )
                })?;
            }
            PlannedFileContents::Binary(contents) => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|_| {
                        AppError::new(
                            "workspace_write_failed",
                            "The target workspace could not be prepared",
                        )
                    })?;
                }
                fs::write(path, contents).map_err(|_| {
                    AppError::new(
                        "workspace_write_failed",
                        "A target resource could not be written",
                    )
                })?;
            }
            PlannedFileContents::Delete => {
                if path.exists() {
                    fs::remove_file(path).map_err(|_| {
                        AppError::new(
                            "workspace_write_failed",
                            "A target file could not be deleted",
                        )
                    })?;
                }
            }
        }
    }
    Ok(())
}
