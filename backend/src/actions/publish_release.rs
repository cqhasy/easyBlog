use chrono::{SecondsFormat, Utc};

use crate::{
    actions::preview_release,
    changes::change::ChangeKind,
    releases::{commit, push, stage},
    shared::errors::{AppError, AppResult},
    storage::{
        changes::ChangeRepository,
        publications::{PublicationRecord, PublicationRepository, PublicationState},
        scopes::ScopeRepository,
        sources::SourceRepository,
    },
    targets::Target,
    workspace::Checkout,
};

pub struct PublishReleaseInput {
    pub scope_id: String,
    pub target: Target,
    pub change_ids: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct Publication {
    pub batch_id: String,
    pub commit_sha: String,
    pub published_at: String,
}

pub fn execute(
    sources: &SourceRepository,
    scopes: &ScopeRepository,
    changes: &ChangeRepository,
    publications: &PublicationRepository,
    input: PublishReleaseInput,
) -> AppResult<Publication> {
    let scope = scopes
        .get(&input.scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    preview_release::validate_scope_target(&scope, &input.target)?;
    let source = sources
        .get(&scope.source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .ok_or_else(|| AppError::new("source_not_found", "Source no longer exists"))?;
    let available = changes
        .list(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))?;
    let selected = preview_release::select_pending_changes(&available, &input.change_ids)?;
    let baseline_before_publish = changes
        .list_snapshots(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Snapshots could not be loaded"))?;
    preview_release::validate_publishable_source(&source)?;
    let checkout = Checkout::acquire(&input.target)
        .map_err(|_| AppError::new("target_unavailable", "The publishing target is not ready"))?;
    let files = preview_release::build_file_set(&source.path, &input.target, &selected)?;
    stage::apply(checkout.root(), &files)?;
    let commit_sha = commit::create(checkout.root(), "Publish easyBlog release")?;
    let batch_id = uuid::Uuid::new_v4().to_string();
    publications
        .insert_pending(&PublicationRecord {
            batch_id: batch_id.clone(),
            scope_id: scope.id.clone(),
            target_id: input.target.id.clone(),
            commit_sha: commit_sha.clone(),
            change_ids: input.change_ids.clone(),
            snapshots_before_publish: Some(baseline_before_publish.clone()),
            state: PublicationState::PendingPush,
            published_at: None,
            rollback_commit_sha: None,
            rolled_back_at: None,
        })
        .map_err(|_| AppError::new("storage_error", "Release history could not be saved"))?;
    push::execute(checkout.root())?;
    let mut baseline = baseline_before_publish;
    baseline.retain(|snapshot| {
        !selected.iter().any(|change| {
            matches!(change.kind, ChangeKind::Deleted)
                && change.source_identity == snapshot.source_identity
        })
    });
    for snapshot in selected.iter().filter_map(|change| change.snapshot.clone()) {
        baseline.retain(|current| current.source_identity != snapshot.source_identity);
        baseline.push(snapshot);
    }
    changes
        .apply_publication(&scope.id, &baseline, &input.change_ids)
        .map_err(|_| AppError::new("storage_error", "Published state could not be saved"))?;
    let published_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    publications
        .mark_published(&batch_id, &published_at)
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    Ok(Publication {
        batch_id,
        commit_sha,
        published_at,
    })
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use crate::{
        changes::change::{Change, ChangeKind},
        scopes::scope::{Scope, ScopeLifecycle, ScopeSelection, SourceNodeRef},
        sources::source::Source,
        storage::{
            changes::ChangeRepository, scopes::ScopeRepository, snapshots::SnapshotRepository,
            sources::SourceRepository,
        },
    };

    use super::*;

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn publishes_to_the_remote_then_advances_the_published_baseline() {
        let root = std::env::temp_dir().join(format!("easyblog-publish-{}", uuid::Uuid::new_v4()));
        let source_root = root.join("source");
        let target_root = root.join("target");
        let remote_root = root.join("remote.git");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(target_root.join("_posts")).unwrap();
        fs::create_dir_all(&remote_root).unwrap();
        fs::write(source_root.join("hello.md"), "# Hello\n").unwrap();
        git(&remote_root, &["init", "--bare"]);
        git(&target_root, &["init"]);
        fs::write(target_root.join("_posts/.gitkeep"), "").unwrap();
        git(&target_root, &["add", "."]);
        git(
            &target_root,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial",
            ],
        );
        git(
            &target_root,
            &["remote", "add", "origin", remote_root.to_str().unwrap()],
        );
        git(&target_root, &["push", "-u", "origin", "HEAD"]);

        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let snapshots = SnapshotRepository::open(&database).unwrap();
        sources
            .insert(&Source {
                id: "source".into(),
                path: source_root.to_string_lossy().into_owned(),
                name: "Content".into(),
                r#type: "local_directory".into(),
                created_at: "now".into(),
            })
            .unwrap();
        scopes
            .save(
                &Scope {
                    id: "scope".into(),
                    source_id: "source".into(),
                    target_id: Some("target".into()),
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
                },
                None,
            )
            .unwrap();
        changes
            .replace(
                "scope",
                "now",
                &[Change {
                    id: "change".into(),
                    scope_id: "scope".into(),
                    kind: ChangeKind::Added,
                    source_identity: "hello.md".into(),
                    source_path: "hello.md".into(),
                    previous_path: None,
                    title: Some("Hello".into()),
                    selected: true,
                    blocked_reason: None,
                    snapshot: Some(crate::tracking::snapshot::Snapshot {
                        scope_id: "scope".into(),
                        source_identity: "hello.md".into(),
                        source_path: "hello.md".into(),
                        title: Some("Hello".into()),
                        fingerprint: "fingerprint".into(),
                        observed_at: "now".into(),
                    }),
                }],
            )
            .unwrap();

        let publications =
            crate::storage::publications::PublicationRepository::open(&database).unwrap();
        let publication = execute(
            &sources,
            &scopes,
            &changes,
            &publications,
            PublishReleaseInput {
                scope_id: "scope".into(),
                target: Target {
                    state: crate::targets::TargetState::Ready,
                    adapter: Some(crate::targets::PublishingAdapter::GithubPages),
                    ..Target::new("target", &target_root)
                },
                change_ids: vec!["change".into()],
            },
        )
        .unwrap();

        assert!(!publication.commit_sha.is_empty());
        assert_eq!(
            fs::read_to_string(target_root.join("_posts/hello.md")).unwrap(),
            "---\nslug: \"hello\"\ntitle: \"Hello\"\n---\n# Hello\n"
        );
        assert!(changes.list("scope").unwrap().is_empty());
        assert_eq!(changes.list_snapshots("scope").unwrap().len(), 1);
        assert!(matches!(
            publications.get(&publication.batch_id).unwrap(),
            Some(crate::storage::publications::PublicationRecord {
                state: crate::storage::publications::PublicationState::Published,
                ..
            })
        ));
        let remote_post = Command::new("git")
            .args([
                "--git-dir",
                remote_root.to_str().unwrap(),
                "show",
                "HEAD:_posts/hello.md",
            ])
            .output()
            .unwrap();
        assert!(remote_post.status.success());
        assert!(String::from_utf8_lossy(&remote_post.stdout).contains("title: \"Hello\""));

        crate::actions::rollback_publication::execute(
            &changes,
            &publications,
            &publication.batch_id,
            &Target {
                state: crate::targets::TargetState::Ready,
                adapter: Some(crate::targets::PublishingAdapter::GithubPages),
                ..Target::new("target", &target_root)
            },
        )
        .unwrap();
        let rescanned = crate::actions::scan_scope::execute(
            &sources,
            &scopes,
            &snapshots,
            &changes,
            "scope".into(),
        )
        .unwrap();
        assert_eq!(rescanned.changes.len(), 1);
        assert_eq!(rescanned.changes[0].kind, ChangeKind::Added);

        drop(snapshots);
        drop(changes);
        drop(publications);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_target_that_is_not_bound_to_the_scope_before_publishing() {
        let root =
            std::env::temp_dir().join(format!("easyblog-publish-target-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let publications =
            crate::storage::publications::PublicationRepository::open(&database).unwrap();
        sources
            .insert(&Source {
                id: "source".into(),
                path: root.to_string_lossy().into_owned(),
                name: "Content".into(),
                r#type: "local_directory".into(),
                created_at: "now".into(),
            })
            .unwrap();
        scopes
            .save(
                &Scope {
                    id: "scope".into(),
                    source_id: "source".into(),
                    target_id: Some("configured-target".into()),
                    name: "Posts".into(),
                    lifecycle: ScopeLifecycle::Active,
                    revision: 1,
                    selections: vec![],
                    include_patterns: vec![],
                    exclude_patterns: vec![],
                    created_at: "now".into(),
                    updated_at: "now".into(),
                },
                None,
            )
            .unwrap();

        let error = execute(
            &sources,
            &scopes,
            &changes,
            &publications,
            PublishReleaseInput {
                scope_id: "scope".into(),
                target: Target::new("other-target", root.join("other-target")),
                change_ids: vec!["change".into()],
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "target_mismatch");
        drop(publications);
        drop(changes);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }
}
