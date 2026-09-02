use std::path::Path;

use crate::scopes::scope::Scope;

pub fn includes(scope: &Scope, relative_path: &Path) -> bool {
    let path = relative_path.to_string_lossy().replace('\\', "/");
    let selected = scope.selections.iter().any(|selection| {
        let selection_path = selection.node.value.trim_end_matches('/');
        path == selection_path
            || (selection.recursive
                && (selection_path == "."
                    || path
                        .strip_prefix(selection_path)
                        .is_some_and(|suffix| suffix.starts_with('/'))))
    });
    selected
        && (scope.include_patterns.is_empty()
            || scope
                .include_patterns
                .iter()
                .any(|pattern| glob_matches(pattern, &path)))
        && !scope
            .exclude_patterns
            .iter()
            .any(|pattern| glob_matches(pattern, &path))
}

fn glob_matches(pattern: &str, path: &str) -> bool {
    glob_matches_parts(
        &pattern.split('/').collect::<Vec<_>>(),
        &path.split('/').collect::<Vec<_>>(),
    )
}

fn glob_matches_parts(pattern: &[&str], path: &[&str]) -> bool {
    match (pattern.split_first(), path.split_first()) {
        (None, None) => true,
        (Some((part, rest)), _) if *part == "**" => {
            glob_matches_parts(rest, path)
                || path
                    .split_first()
                    .is_some_and(|(_, remaining)| glob_matches_parts(pattern, remaining))
        }
        (Some((part, rest)), Some((segment, remaining))) if segment_matches(part, segment) => {
            glob_matches_parts(rest, remaining)
        }
        _ => false,
    }
}

fn segment_matches(pattern: &str, value: &str) -> bool {
    let mut pattern = pattern.chars().peekable();
    let mut value = value.chars().peekable();
    while let Some(character) = pattern.next() {
        match character {
            '?' if value.next().is_some() => {}
            '*' => {
                let rest = pattern.collect::<String>();
                return (0..=value.clone().count()).any(|skip| {
                    let candidate = value.clone().skip(skip).collect::<String>();
                    segment_matches(&rest, &candidate)
                });
            }
            character if value.next() == Some(character) => {}
            _ => return false,
        }
    }
    value.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scopes::scope::{Scope, ScopeLifecycle, ScopeSelection, SourceNodeRef};

    fn scope() -> Scope {
        Scope {
            id: "scope".into(),
            source_id: "source".into(),
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            revision: 1,
            selections: vec![ScopeSelection {
                node: SourceNodeRef {
                    kind: "local_path".into(),
                    value: "posts".into(),
                },
                recursive: true,
                display_name: "Posts".into(),
            }],
            include_patterns: vec!["posts/**/*.md".into()],
            exclude_patterns: vec!["posts/drafts/**".into()],
            created_at: "now".into(),
            updated_at: "now".into(),
        }
    }

    #[test]
    fn applies_selection_recursion_and_glob_rules() {
        let scope = scope();
        assert!(includes(&scope, Path::new("posts/hello.md")));
        assert!(!includes(&scope, Path::new("posts/drafts/hello.md")));
        assert!(!includes(&scope, Path::new("notes/hello.md")));
        assert!(!includes(&scope, Path::new("posts/hello.txt")));
    }
}
