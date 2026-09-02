use chrono::{SecondsFormat, Utc};

use crate::changes::change::{Change, ChangeKind};
use crate::changes::{compare, scan};
use crate::content::normalize_local_markdown;
use crate::providers::local::reader::LocalReader;
use crate::scopes::scope::ScopeLifecycle;
use crate::shared::errors::{AppError, AppResult};
use crate::storage::changes::ChangeRepository;
use crate::storage::scopes::ScopeRepository;
use crate::storage::snapshots::SnapshotRepository;
use crate::storage::sources::SourceRepository;
use crate::tracking::snapshot::Snapshot;
use crate::tracking::{fingerprint, identity};

pub fn execute(
    sources: &SourceRepository,
    scopes: &ScopeRepository,
    snapshots: &SnapshotRepository,
    changes: &ChangeRepository,
    scope_id: String,
) -> AppResult<crate::changes::change_set::ChangeSet> {
    let scope = scopes
        .get(&scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    if scope.lifecycle != ScopeLifecycle::Active {
        return Err(AppError::new(
            "scope_not_active",
            "Only active scopes can be scanned",
        ));
    }
    let source = sources
        .get(&scope.source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .ok_or_else(|| AppError::new("source_not_found", "Source no longer exists"))?;
    if source.r#type != "local_directory" {
        return Err(AppError::new(
            "unsupported_source",
            "This source type cannot be scanned yet",
        ));
    }
    let previous = snapshots
        .list(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Snapshots could not be loaded"))?;
    let reader = LocalReader::new(&source.path)
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be read"))?;
    let observed_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let mut current = Vec::new();
    let mut blocked = Vec::new();
    for file in reader
        .list_markdown()
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be scanned"))?
    {
        if !scan::includes(&scope, &file.relative_path) {
            continue;
        }
        let identity = identity::local_source_identity(&file.relative_path);
        match normalize_local_markdown(identity.clone(), &file.content) {
            Ok(article) => current.push(Snapshot {
                scope_id: scope.id.clone(),
                source_identity: identity,
                source_path: identity::local_source_identity(&file.relative_path),
                title: article.title.clone(),
                fingerprint: fingerprint::for_article(&article),
                observed_at: observed_at.clone(),
            }),
            Err(_) => {
                if let Some(previous) = previous
                    .iter()
                    .find(|snapshot| snapshot.source_identity == identity)
                {
                    current.push(previous.clone());
                }
                blocked.push(Change {
                    id: format!("{}:{}:blocked", scope.id, identity),
                    scope_id: scope.id.clone(),
                    kind: ChangeKind::Blocked,
                    source_identity: identity.clone(),
                    source_path: identity,
                    previous_path: None,
                    title: None,
                    selected: false,
                    blocked_reason: Some("Markdown content could not be normalized".into()),
                    snapshot: None,
                });
            }
        }
    }
    let mut detected = compare::compare(&scope.id, &previous, &current);
    detected.extend(blocked);
    detected.sort_by(|left, right| left.source_path.cmp(&right.source_path));
    // Snapshots are the last published baseline, not the last scan result. Advancing
    // them here would make an unconfirmed change disappear on the next scan.
    let snapshots_to_persist = if detected.is_empty() {
        &current
    } else {
        &previous
    };
    changes
        .replace_scan_result(&scope.id, &observed_at, snapshots_to_persist, &detected)
        .map_err(|_| AppError::new("storage_error", "Scan results could not be saved"))?;
    Ok(crate::changes::change_set::ChangeSet {
        scope_id: scope.id,
        scanned_at: observed_at,
        changes: detected,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::changes::change::ChangeKind;
    use crate::scopes::scope::{Scope, ScopeLifecycle, ScopeSelection, SourceNodeRef};
    use crate::sources::source::Source;

    use super::*;

    fn temp_root() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("easyblog-scan-scope-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn keeps_unpublished_changes_pending_across_repeated_scans() {
        let root = temp_root();
        let content = root.join("content");
        fs::create_dir(&content).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let snapshots = SnapshotRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let source = Source {
            id: "source".into(),
            path: fs::canonicalize(&content)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        sources.insert(&source).unwrap();
        let scope = Scope {
            id: "scope".into(),
            source_id: source.id,
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            revision: 1,
            selections: vec![ScopeSelection {
                node: SourceNodeRef {
                    kind: "local_path".into(),
                    value: ".".into(),
                },
                recursive: true,
                display_name: "Content".into(),
            }],
            include_patterns: vec![],
            exclude_patterns: vec![],
            created_at: "2026-09-02T00:00:00Z".into(),
            updated_at: "2026-09-02T00:00:00Z".into(),
        };
        scopes.save(&scope, None).unwrap();

        let article_path = content.join("post.md");
        fs::write(&article_path, "# First\n").unwrap();
        let first = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        assert_eq!(first.changes.len(), 1);
        assert_eq!(first.changes[0].kind, ChangeKind::Added);
        assert!(first.changes[0].selected);

        let repeated = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        assert_eq!(repeated.changes.len(), 1);
        assert_eq!(repeated.changes[0].kind, ChangeKind::Added);
        assert!(repeated.changes[0].selected);

        fs::write(&article_path, "# Revised\n").unwrap();
        let second = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        assert_eq!(second.changes[0].kind, ChangeKind::Added);
        assert_eq!(changes.list(&scope.id).unwrap()[0].kind, ChangeKind::Added);

        fs::remove_file(article_path).unwrap();
        let third = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        assert!(third.changes.is_empty());
        assert!(snapshots.list(&scope.id).unwrap().is_empty());

        drop(changes);
        drop(snapshots);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_the_previous_snapshot_when_markdown_becomes_blocked() {
        let root = temp_root();
        let content = root.join("content");
        fs::create_dir(&content).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let snapshots = SnapshotRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let source = Source {
            id: "source".into(),
            path: fs::canonicalize(&content)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        sources.insert(&source).unwrap();
        let scope = Scope {
            id: "scope".into(),
            source_id: source.id,
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            revision: 1,
            selections: vec![ScopeSelection {
                node: SourceNodeRef {
                    kind: "local_path".into(),
                    value: ".".into(),
                },
                recursive: true,
                display_name: "Content".into(),
            }],
            include_patterns: vec![],
            exclude_patterns: vec![],
            created_at: "2026-09-02T00:00:00Z".into(),
            updated_at: "2026-09-02T00:00:00Z".into(),
        };
        scopes.save(&scope, None).unwrap();

        let article_path = content.join("post.md");
        fs::write(&article_path, "# First\n").unwrap();
        execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        assert!(snapshots.list(&scope.id).unwrap().is_empty());

        fs::write(
            &article_path,
            "---\ntitle: one\ntitle: two\n---\n# Broken\n",
        )
        .unwrap();
        let result = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();

        assert_eq!(result.changes.len(), 1);
        assert_eq!(result.changes[0].kind, ChangeKind::Blocked);
        assert!(!result.changes[0].selected);
        assert_eq!(
            result.changes[0].blocked_reason.as_deref(),
            Some("Markdown content could not be normalized")
        );
        assert!(snapshots.list(&scope.id).unwrap().is_empty());

        drop(changes);
        drop(snapshots);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retains_an_updated_change_until_a_publication_advances_the_baseline() {
        let root = temp_root();
        let content = root.join("content");
        fs::create_dir(&content).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let snapshots = SnapshotRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let source = Source {
            id: "source".into(),
            path: fs::canonicalize(&content)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            name: "Content".into(),
            r#type: "local_directory".into(),
            created_at: "now".into(),
        };
        sources.insert(&source).unwrap();
        let scope = Scope {
            id: "scope".into(),
            source_id: source.id,
            target_id: None,
            name: "Posts".into(),
            lifecycle: ScopeLifecycle::Active,
            revision: 1,
            selections: vec![ScopeSelection {
                node: SourceNodeRef {
                    kind: "local_path".into(),
                    value: ".".into(),
                },
                recursive: true,
                display_name: "Content".into(),
            }],
            include_patterns: vec![],
            exclude_patterns: vec![],
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        scopes.save(&scope, None).unwrap();
        let article_path = content.join("post.md");
        fs::write(&article_path, "# Published\n").unwrap();
        snapshots
            .replace(
                &scope.id,
                &[Snapshot {
                    scope_id: scope.id.clone(),
                    source_identity: "post.md".into(),
                    source_path: "post.md".into(),
                    title: Some("Published".into()),
                    fingerprint: fingerprint::for_article(
                        &normalize_local_markdown("post.md", "# Published\n").unwrap(),
                    ),
                    observed_at: "published".into(),
                }],
            )
            .unwrap();

        fs::write(&article_path, "# Revised\n").unwrap();
        let first = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();
        let repeated = execute(&sources, &scopes, &snapshots, &changes, scope.id.clone()).unwrap();

        assert_eq!(first.changes[0].kind, ChangeKind::Updated);
        assert_eq!(repeated.changes[0].kind, ChangeKind::Updated);
        assert_eq!(
            snapshots.list(&scope.id).unwrap()[0].title.as_deref(),
            Some("Published")
        );

        drop(changes);
        drop(snapshots);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }
}
