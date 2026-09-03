use chrono::{SecondsFormat, Utc};

use crate::{
    actions::preview_release,
    releases::{commit, push, stage},
    shared::errors::{AppError, AppResult},
    storage::{
        changes::ChangeRepository,
        ledger::LedgerRepository,
        publications::{PublicationRecord, PublicationRepository, PublicationState},
        scopes::ScopeRepository,
        sources::SourceRepository,
    },
    targets::Target,
    workspace::Checkout,
};

pub struct PublishReleaseInput {
    pub batch_id: String,
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
    ledger: &LedgerRepository,
    publications: &PublicationRepository,
    target: Target,
    input: PublishReleaseInput,
) -> AppResult<Publication> {
    let batch = ledger
        .load_batch(&input.batch_id)
        .map_err(|_| AppError::new("storage_error", "Release batch could not be loaded"))?
        .ok_or_else(|| AppError::new("release_not_found", "Release preview no longer exists"))?;
    if batch.state != crate::releases::BatchState::Previewed {
        return Err(AppError::new(
            "release_not_publishable",
            "This release preview can no longer be confirmed",
        ));
    }
    let scope = scopes
        .get(&batch.scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    preview_release::validate_scope_target(&scope, &target)?;
    let source = sources
        .get(&scope.source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .ok_or_else(|| AppError::new("source_not_found", "Source no longer exists"))?;
    let available = changes
        .list(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))?;
    let selected = preview_release::select_pending_changes(&available, &batch.change_ids)?;
    preview_release::validate_publishable_source(&source)?;
    let checkout = Checkout::acquire(&target).map_err(preview_release::checkout_error)?;
    if scope.revision != batch.scope_revision
        || crate::providers::git::GitCommands::commit_sha(checkout.root()).map_err(|_| {
            AppError::new("target_unavailable", "The target workspace is unavailable")
        })? != batch.target_head_before
    {
        return Err(AppError::new(
            "release_preview_invalidated",
            "The source scope or target changed after preview",
        ));
    }
    let transitions = ledger
        .load_source_transitions(&batch.id)
        .map_err(|_| AppError::new("storage_error", "Release preview could not be validated"))?;
    if selected.iter().any(|change| {
        transitions
            .iter()
            .find(|transition| transition.source_identity == change.source_identity)
            .is_none_or(|transition| {
                transition
                    .after
                    .as_ref()
                    .map(|snapshot| &snapshot.fingerprint)
                    != change
                        .snapshot
                        .as_ref()
                        .map(|snapshot| &snapshot.fingerprint)
            })
    }) {
        return Err(AppError::new(
            "release_preview_invalidated",
            "Selected source content changed after preview",
        ));
    }
    let live_selected = selected
        .iter()
        .filter(|change| !matches!(change.kind, crate::changes::change::ChangeKind::Deleted))
        .cloned()
        .collect::<Vec<_>>();
    let mut files = preview_release::build_file_set(&source.path, &target, &live_selected)?;
    let operations = ledger
        .load_operations(&batch.id)
        .map_err(|_| AppError::new("storage_error", "Release operations could not be loaded"))?;
    if operations.is_empty() {
        return Err(AppError::new(
            "release_legacy_unsupported",
            "This release preview has no immutable operation ledger",
        ));
    }
    preview_release::append_frozen_deletes(&mut files, &operations)?;
    preview_release::validate_frozen_operations(checkout.root(), &files, &operations)?;
    if !ledger
        .begin_publish(&batch.id)
        .map_err(|_| AppError::new("storage_error", "Release preview could not be claimed"))?
    {
        return Err(AppError::new(
            "release_not_publishable",
            "This release preview is already being handled",
        ));
    }
    if let Err(error) = stage::apply(checkout.root(), &files) {
        let _ = ledger.mark_recovery_required(&batch.id, "workspace_write_failed");
        return Err(error);
    }
    let commit_sha = match commit::create(checkout.root(), "Publish easyBlog release") {
        Ok(commit_sha) => commit_sha,
        Err(error) => {
            let _ = ledger.mark_recovery_required(&batch.id, "git_commit_failed");
            return Err(error);
        }
    };
    publications
        .insert_pending(&PublicationRecord {
            batch_id: batch.id.clone(),
            scope_id: scope.id.clone(),
            target_id: target.id.clone(),
            commit_sha: commit_sha.clone(),
            change_ids: batch.change_ids.clone(),
            snapshots_before_publish: None,
            state: PublicationState::PendingPush,
            published_at: None,
            rollback_commit_sha: None,
            rolled_back_at: None,
        })
        .map_err(|_| {
            let _ = ledger.mark_recovery_required(&batch.id, "publication_history_write_failed");
            AppError::new("storage_error", "Release history could not be saved")
        })?;
    ledger
        .mark_pending_push(&batch.id, &commit_sha)
        .map_err(|_| {
            let _ = ledger.mark_recovery_required(&batch.id, "release_commit_record_failed");
            AppError::new("storage_error", "Release commit could not be recorded")
        })?;
    push::execute(checkout.root())?;
    changes
        .finalize_release_baselines(&scope.id, &transitions)
        .map_err(|_| AppError::new("storage_error", "Published state could not be saved"))?;
    let published_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    publications
        .mark_published(&batch.id, &published_at)
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    ledger
        .finalize_publish(&batch.id, &commit_sha, &published_at)
        .map_err(|_| AppError::new("storage_error", "Release ledger could not be finalized"))?;
    Ok(Publication {
        batch_id: batch.id,
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
            changes::ChangeRepository,
            scopes::ScopeRepository,
            snapshots::SnapshotRepository,
            sources::SourceRepository,
            targets::{ConnectedTarget, TargetRepository},
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
        let ledger = crate::storage::ledger::LedgerRepository::open(&database).unwrap();
        let target = Target {
            state: crate::targets::TargetState::Ready,
            adapter: Some(crate::targets::PublishingAdapter::GithubPages),
            ..Target::new("target", &target_root)
        };
        let targets = TargetRepository::open(&database).unwrap();
        targets
            .insert(&ConnectedTarget {
                target: target.clone(),
                name: "Target".into(),
                created_at: "now".into(),
            })
            .unwrap();
        let plan = crate::actions::preview_release::execute(
            &sources,
            &scopes,
            &changes,
            &ledger,
            crate::actions::preview_release::PreviewReleaseInput {
                scope_id: "scope".into(),
                target: target.clone(),
                change_ids: vec!["change".into()],
            },
        )
        .unwrap();
        let publication = execute(
            &sources,
            &scopes,
            &changes,
            &ledger,
            &publications,
            target.clone(),
            PublishReleaseInput {
                batch_id: plan.batch.id,
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
            &ledger,
            &publications,
            &publication.batch_id,
            &target,
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
        drop(ledger);
        drop(targets);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_missing_release_batch_before_resolving_a_target() {
        let root =
            std::env::temp_dir().join(format!("easyblog-publish-target-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let publications =
            crate::storage::publications::PublicationRepository::open(&database).unwrap();
        let ledger = crate::storage::ledger::LedgerRepository::open(&database).unwrap();
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
            &ledger,
            &publications,
            Target::new("other-target", root.join("other-target")),
            PublishReleaseInput {
                batch_id: "missing".into(),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "release_not_found");
        drop(publications);
        drop(ledger);
        drop(changes);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }
}
