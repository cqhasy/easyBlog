use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileChangeKind {
    Added,
    Modified,
    Deleted,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDiff {
    pub path: PathBuf,
    pub kind: FileChangeKind,
    pub patch: String,
}

pub struct Diff;

impl Diff {
    pub fn text(path: impl Into<PathBuf>, before: Option<&str>, after: Option<&str>) -> FileDiff {
        let path = path.into();
        let kind = match (before, after) {
            (None, Some(_)) => FileChangeKind::Added,
            (Some(_), None) => FileChangeKind::Deleted,
            (Some(before), Some(after)) if before == after => FileChangeKind::Unchanged,
            (Some(_), Some(_)) => FileChangeKind::Modified,
            (None, None) => FileChangeKind::Unchanged,
        };
        let patch = if kind == FileChangeKind::Unchanged {
            String::new()
        } else {
            unified_patch(&path, before, after)
        };
        FileDiff { path, kind, patch }
    }
}

fn unified_patch(path: &Path, before: Option<&str>, after: Option<&str>) -> String {
    let old_name = if before.is_some() {
        format!("a/{}", path.display())
    } else {
        "/dev/null".into()
    };
    let new_name = if after.is_some() {
        format!("b/{}", path.display())
    } else {
        "/dev/null".into()
    };
    let mut patch = format!("--- {old_name}\n+++ {new_name}\n");
    if let Some(before) = before {
        for line in before.lines() {
            patch.push('-');
            patch.push_str(line);
            patch.push('\n');
        }
    }
    if let Some(after) = after {
        for line in after.lines() {
            patch.push('+');
            patch.push_str(line);
            patch.push('\n');
        }
    }
    patch
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_deterministic_structured_diffs_without_writing_a_workspace() {
        let added = Diff::text("_posts/hello.md", None, Some("# Hello\n"));
        assert_eq!(added.kind, FileChangeKind::Added);
        assert_eq!(
            added.patch,
            "--- /dev/null\n+++ b/_posts/hello.md\n+# Hello\n"
        );
        let unchanged = Diff::text("_posts/hello.md", Some("same\n"), Some("same\n"));
        assert_eq!(unchanged.kind, FileChangeKind::Unchanged);
        assert!(unchanged.patch.is_empty());
    }
}
