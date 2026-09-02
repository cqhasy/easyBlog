use crate::scopes::rules::validate_patterns;
use crate::scopes::scope::{
    SaveScopeInput, Scope, ScopeDiagnostic, ScopeHealth, ScopeLifecycle, ScopeSummary,
};
use crate::shared::errors::{AppError, AppResult};
use crate::storage::scopes::ScopeRepository;
use crate::storage::sources::SourceRepository;
use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

pub fn save(
    sources: &SourceRepository,
    scopes: &ScopeRepository,
    mut input: SaveScopeInput,
    expected_revision: Option<i64>,
) -> AppResult<ScopeSummary> {
    input.include_patterns = normalize_patterns(input.include_patterns);
    input.exclude_patterns = normalize_patterns(input.exclude_patterns);
    validate_input(sources, &input)?;
    let existing = input
        .id
        .as_deref()
        .map(|id| scopes.get(id))
        .transpose()
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .flatten();
    if input.id.is_some() && existing.is_none() {
        return Err(AppError::new("scope_not_found", "Scope no longer exists"));
    }
    if let Some(existing) = &existing {
        if existing.source_id != input.source_id {
            return Err(AppError::new(
                "scope_source_immutable",
                "A scope cannot be moved to another source",
            ));
        }
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let scope = Scope {
        id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        source_id: input.source_id,
        target_id: input.target_id,
        name: input.name.trim().to_owned(),
        lifecycle: input.lifecycle,
        revision: existing
            .as_ref()
            .map(|scope| scope.revision + 1)
            .unwrap_or(1),
        selections: input.selections,
        include_patterns: input.include_patterns,
        exclude_patterns: input.exclude_patterns,
        created_at: existing
            .as_ref()
            .map(|scope| scope.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };
    if !scopes
        .save(&scope, expected_revision)
        .map_err(|_| AppError::new("storage_error", "Scope could not be saved"))?
    {
        return Err(AppError::new(
            "scope_revision_conflict",
            "Scope was updated in another window",
        ));
    }
    Ok(summary(scope))
}

pub fn list(scopes: &ScopeRepository, source_id: Option<String>) -> AppResult<Vec<ScopeSummary>> {
    let items = scopes
        .list(source_id.as_deref())
        .map_err(|_| AppError::new("storage_error", "Scopes could not be loaded"))?;
    Ok(items
        .iter()
        .cloned()
        .map(|scope| summary_with_overlap(scope, &items))
        .collect())
}

pub fn set_lifecycle(
    scopes: &ScopeRepository,
    scope_id: String,
    lifecycle: ScopeLifecycle,
    expected_revision: i64,
) -> AppResult<ScopeSummary> {
    let mut scope = scopes
        .get(&scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    scope.lifecycle = lifecycle;
    scope.revision += 1;
    scope.updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    if !scopes
        .save(&scope, Some(expected_revision))
        .map_err(|_| AppError::new("storage_error", "Scope could not be saved"))?
    {
        return Err(AppError::new(
            "scope_revision_conflict",
            "Scope was updated in another window",
        ));
    }
    Ok(summary(scope))
}

fn validate_input(sources: &SourceRepository, input: &SaveScopeInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::new(
            "invalid_scope_name",
            "Scope name cannot be empty",
        ));
    }
    if input.selections.is_empty() {
        return Err(AppError::new(
            "empty_scope_selection",
            "Select at least one file or directory",
        ));
    }
    if !validate_patterns(&input.include_patterns) || !validate_patterns(&input.exclude_patterns) {
        return Err(AppError::new(
            "invalid_scope_pattern",
            "Patterns must be relative paths using forward slashes",
        ));
    }
    if input.selections.iter().any(|selection| {
        selection.node.kind != "local_path"
            || selection.node.value.starts_with('/')
            || selection.node.value.contains('\\')
            || selection.node.value.split('/').any(|part| part == "..")
            || selection.node.value.trim().is_empty()
    }) {
        return Err(AppError::new(
            "invalid_scope_selection",
            "Scope selections must be relative local paths",
        ));
    }
    if sources
        .get(&input.source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .is_none()
    {
        return Err(AppError::new("source_not_found", "Source no longer exists"));
    }
    Ok(())
}

fn normalize_patterns(patterns: Vec<String>) -> Vec<String> {
    patterns
        .into_iter()
        .map(|pattern| pattern.trim().to_owned())
        .filter(|pattern| !pattern.is_empty())
        .collect()
}
fn summary(scope: Scope) -> ScopeSummary {
    summary_with_overlap(scope, &[])
}

fn summary_with_overlap(scope: Scope, candidates: &[Scope]) -> ScopeSummary {
    let mut diagnostics = Vec::new();
    let health = if scope.lifecycle == ScopeLifecycle::Deleted {
        ScopeHealth::Blocked
    } else if scope.target_id.as_ref().is_some_and(|target_id| {
        candidates.iter().any(|candidate| {
            candidate.id != scope.id
                && candidate.lifecycle != ScopeLifecycle::Deleted
                && candidate.source_id == scope.source_id
                && candidate
                    .target_id
                    .as_ref()
                    .is_some_and(|other| other != target_id)
                && candidate.selections.iter().any(|other| {
                    scope
                        .selections
                        .iter()
                        .any(|selection| selections_overlap(selection, other))
                })
        })
    }) {
        diagnostics.push(ScopeDiagnostic {
            code: "cross_target_overlap".into(),
            message: "This selection overlaps a scope bound to another target".into(),
        });
        ScopeHealth::Blocked
    } else if scope.target_id.is_none() {
        diagnostics.push(ScopeDiagnostic {
            code: "needs_target".into(),
            message: "Bind a publishing target before release preview".into(),
        });
        ScopeHealth::NeedsTarget
    } else {
        ScopeHealth::Ready
    };
    ScopeSummary {
        scope,
        health,
        diagnostics,
    }
}

fn selections_overlap(
    left: &crate::scopes::scope::ScopeSelection,
    right: &crate::scopes::scope::ScopeSelection,
) -> bool {
    left.node == right.node
        || (left.recursive && is_ancestor_path(&left.node.value, &right.node.value))
        || (right.recursive && is_ancestor_path(&right.node.value, &left.node.value))
}

fn is_ancestor_path(ancestor: &str, descendant: &str) -> bool {
    ancestor == "."
        || descendant
            .strip_prefix(ancestor)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::source::Source;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("easyblog-configure-scope-{suffix}.db"))
    }

    fn scope(id: &str, target_id: &str) -> Scope {
        Scope {
            id: id.into(),
            source_id: "source-1".into(),
            target_id: Some(target_id.into()),
            name: id.into(),
            lifecycle: ScopeLifecycle::Active,
            revision: 1,
            selections: vec![crate::scopes::scope::ScopeSelection {
                node: crate::scopes::scope::SourceNodeRef {
                    kind: "local_path".into(),
                    value: "posts".into(),
                },
                recursive: true,
                display_name: "posts".into(),
            }],
            include_patterns: vec![],
            exclude_patterns: vec![],
            created_at: "2026-09-02T00:00:00Z".into(),
            updated_at: "2026-09-02T00:00:00Z".into(),
        }
    }

    #[test]
    fn marks_same_source_overlap_across_targets_as_blocked() {
        let first = scope("scope-1", "target-a");
        let second = scope("scope-2", "target-b");
        let summary = summary_with_overlap(first, &[second]);
        assert_eq!(summary.health, ScopeHealth::Blocked);
        assert_eq!(summary.diagnostics[0].code, "cross_target_overlap");
    }

    #[test]
    fn marks_recursive_ancestor_overlap_across_targets_as_blocked() {
        let first = scope("scope-1", "target-a");
        let mut second = scope("scope-2", "target-b");
        second.selections[0].node.value = "posts/article.md".into();
        second.selections[0].recursive = false;

        let summary = summary_with_overlap(first, &[second]);

        assert_eq!(summary.health, ScopeHealth::Blocked);
        assert_eq!(summary.diagnostics[0].code, "cross_target_overlap");
    }

    #[test]
    fn rejects_empty_scope_selections_before_storage() {
        let path = temp_db();
        let sources = SourceRepository::open(&path).unwrap();
        let scopes = ScopeRepository::open(&path).unwrap();
        let source = Source {
            id: "source-1".into(),
            path: "C:/content".into(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        sources.insert(&source).unwrap();
        let input = SaveScopeInput {
            id: None,
            source_id: source.id.clone(),
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            selections: vec![],
            include_patterns: vec![],
            exclude_patterns: vec![],
        };
        let error = save(&sources, &scopes, input, None).unwrap_err();
        assert_eq!(error.code, "empty_scope_selection");
        drop(scopes);
        drop(sources);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_patterns_that_become_absolute_after_normalization() {
        let path = temp_db();
        let sources = SourceRepository::open(&path).unwrap();
        let scopes = ScopeRepository::open(&path).unwrap();
        let source = Source {
            id: "source-1".into(),
            path: "C:/content".into(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        sources.insert(&source).unwrap();
        let mut input = SaveScopeInput {
            id: None,
            source_id: source.id.clone(),
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            selections: scope("unused", "target").selections,
            include_patterns: vec![" /private/** ".into()],
            exclude_patterns: vec![],
        };
        let error = save(&sources, &scopes, input.clone(), None).unwrap_err();
        assert_eq!(error.code, "invalid_scope_pattern");

        input.include_patterns = vec![" posts/**/*.md ".into()];
        let saved = save(&sources, &scopes, input, None).unwrap();
        assert_eq!(saved.scope.include_patterns, vec!["posts/**/*.md"]);
        drop(scopes);
        drop(sources);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn requires_a_revision_when_updating_an_existing_scope() {
        let path = temp_db();
        let sources = SourceRepository::open(&path).unwrap();
        let scopes = ScopeRepository::open(&path).unwrap();
        let source = Source {
            id: "source-1".into(),
            path: "C:/content".into(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        sources.insert(&source).unwrap();
        let input = SaveScopeInput {
            id: None,
            source_id: source.id.clone(),
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            selections: scope("unused", "target").selections,
            include_patterns: vec![],
            exclude_patterns: vec![],
        };
        let saved = save(&sources, &scopes, input, None).unwrap();
        let update = SaveScopeInput {
            id: Some(saved.scope.id),
            source_id: source.id,
            target_id: None,
            name: "Renamed posts".into(),
            lifecycle: ScopeLifecycle::Active,
            selections: saved.scope.selections,
            include_patterns: vec![],
            exclude_patterns: vec![],
        };

        let error = save(&sources, &scopes, update, None).unwrap_err();
        assert_eq!(error.code, "scope_revision_conflict");
        drop(scopes);
        drop(sources);
        let _ = std::fs::remove_file(path);
    }
}
