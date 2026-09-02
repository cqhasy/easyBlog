use crate::shared::errors::{AppError, AppResult};
use crate::sources::source::Source;
use crate::storage::sources::SourceRepository;
use chrono::{SecondsFormat, Utc};
use rusqlite::Error as SqliteError;
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("easyblog-add-source-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn registers_canonical_directory_with_default_name() {
        let root = temp_root();
        let repo = SourceRepository::open(root.join("sources.db")).unwrap();
        let nested = root.join("content");
        fs::create_dir(&nested).unwrap();

        let source = execute(&repo, nested.to_string_lossy().to_string(), None).unwrap();

        assert_eq!(
            source.path,
            fs::canonicalize(&nested).unwrap().to_string_lossy()
        );
        assert_eq!(source.name, "content");
        assert_eq!(source.r#type, "local_directory");
        assert!(!source.created_at.is_empty());
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_file_and_missing_paths() {
        let root = temp_root();
        let repo = SourceRepository::open(root.join("sources.db")).unwrap();
        let file = root.join("article.md");
        fs::write(&file, "# article").unwrap();

        assert_eq!(
            execute(&repo, file.to_string_lossy().to_string(), None)
                .unwrap_err()
                .code,
            "not_directory"
        );
        assert_eq!(
            execute(
                &repo,
                root.join("missing").to_string_lossy().to_string(),
                None
            )
            .unwrap_err()
            .code,
            "invalid_path"
        );
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_duplicate_canonical_directory() {
        let root = temp_root();
        let repo = SourceRepository::open(root.join("sources.db")).unwrap();
        let nested = root.join("content");
        fs::create_dir(&nested).unwrap();
        let path = nested.to_string_lossy().to_string();

        execute(&repo, path.clone(), Some("One".into())).unwrap();
        let error = execute(&repo, path, Some("Two".into())).unwrap_err();
        assert_eq!(error.code, "duplicate_source");
        drop(repo);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uses_canonical_path_as_default_name_for_root_directory() {
        let root = std::env::current_dir()
            .unwrap()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        let canonical = fs::canonicalize(root).unwrap();

        assert_eq!(source_name(&canonical, None), canonical.to_string_lossy());
    }
}

pub fn execute(
    repository: &SourceRepository,
    path: String,
    name: Option<String>,
) -> AppResult<Source> {
    let input = path.trim();
    if input.is_empty() {
        return Err(AppError::new("invalid_path", "Source path cannot be empty"));
    }
    let canonical = fs::canonicalize(input).map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            AppError::new("not_readable", "Source path is not accessible")
        } else {
            AppError::new("invalid_path", "Source path does not exist")
        }
    })?;
    let metadata = fs::metadata(&canonical)
        .map_err(|_| AppError::new("not_readable", "Source path metadata is not accessible"))?;
    if !metadata.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "Source path must be a directory",
        ));
    }
    fs::read_dir(&canonical)
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be read"))?;

    let source_name = source_name(&canonical, name.as_deref());

    let source = Source {
        id: Uuid::new_v4().to_string(),
        path: canonical.to_string_lossy().into_owned(),
        name: source_name,
        r#type: "local_directory".into(),
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };
    repository.insert(&source).map_err(|error| {
        if is_unique_constraint(&error) {
            AppError::new(
                "duplicate_source",
                "This source directory is already registered",
            )
        } else {
            AppError::new("storage_error", "Source could not be saved")
        }
    })?;
    Ok(source)
}

fn source_name(canonical: &Path, name: Option<&str>) -> String {
    name.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            canonical
                .file_name()
                .and_then(|value| value.to_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| canonical.to_string_lossy().into_owned())
}

fn is_unique_constraint(error: &SqliteError) -> bool {
    matches!(
        error,
        SqliteError::SqliteFailure(details, _)
            if details.code == rusqlite::ErrorCode::ConstraintViolation
    )
}
