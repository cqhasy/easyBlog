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
    let before_lines = before.map(lines).unwrap_or_default();
    let after_lines = after.map(lines).unwrap_or_default();
    patch.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        hunk_start(before_lines.len()),
        before_lines.len(),
        hunk_start(after_lines.len()),
        after_lines.len()
    ));
    for line in before_lines {
        append_diff_line(&mut patch, '-', line);
    }
    for line in after_lines {
        append_diff_line(&mut patch, '+', line);
    }
    patch
}

#[derive(Debug, Clone, Copy)]
struct TextLine<'a> {
    content: &'a str,
    has_newline: bool,
}

fn lines(input: &str) -> Vec<TextLine<'_>> {
    if input.is_empty() {
        return Vec::new();
    }
    input
        .split_inclusive('\n')
        .map(|line| TextLine {
            content: line.strip_suffix('\n').unwrap_or(line),
            has_newline: line.ends_with('\n'),
        })
        .collect()
}

fn hunk_start(line_count: usize) -> usize {
    if line_count == 0 {
        0
    } else {
        1
    }
}

fn append_diff_line(patch: &mut String, prefix: char, line: TextLine<'_>) {
    patch.push(prefix);
    patch.push_str(line.content);
    patch.push('\n');
    if !line.has_newline {
        patch.push_str("\\ No newline at end of file\n");
    }
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
            "--- /dev/null\n+++ b/_posts/hello.md\n@@ -0,0 +1,1 @@\n+# Hello\n"
        );
        let unchanged = Diff::text("_posts/hello.md", Some("same\n"), Some("same\n"));
        assert_eq!(unchanged.kind, FileChangeKind::Unchanged);
        assert!(unchanged.patch.is_empty());
    }

    #[test]
    fn preserves_final_newline_state_in_a_valid_unified_diff() {
        let diff = Diff::text("_posts/hello.md", Some("same\n"), Some("same"));
        assert_eq!(diff.kind, FileChangeKind::Modified);
        assert_eq!(
            diff.patch,
            "--- a/_posts/hello.md\n+++ b/_posts/hello.md\n@@ -1,1 +1,1 @@\n-same\n+same\n\\ No newline at end of file\n"
        );
    }
}
