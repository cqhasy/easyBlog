use chrono::{SecondsFormat, Utc};

use crate::{
    providers::git::{GitCommandError, GitCommands},
    shared::errors::{AppError, AppResult},
    storage::{
        changes::ChangeRepository,
        publications::{PublicationRepository, PublicationState},
    },
    targets::Target,
    workspace::Checkout,
};

pub fn execute(
    changes: &ChangeRepository,
    publications: &PublicationRepository,
    batch_id: &str,
    target: &Target,
) -> AppResult<String> {
    let record = publications
        .get(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))?
        .ok_or_else(|| {
            AppError::new("publication_not_found", "This publication no longer exists")
        })?;
    if record.target_id != target.id {
        return Err(AppError::new(
            "target_mismatch",
            "The selected target does not match this publication",
        ));
    }
    if !matches!(
        record.state,
        PublicationState::Published | PublicationState::RollbackPending
    ) {
        return Err(AppError::new(
            "publication_not_reversible",
            "Only a published release can be rolled back",
        ));
    }
    if !publications
        .is_latest_reversible(&record)
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))?
    {
        return Err(AppError::new(
            "publication_not_latest",
            "Only the latest published release for this scope can be rolled back",
        ));
    }
    let checkout =
        Checkout::acquire(target).map_err(crate::actions::preview_release::checkout_error)?;
    let rollback_sha = if record.state == PublicationState::RollbackPending {
        record.rollback_commit_sha.clone().ok_or_else(|| {
            AppError::new(
                "publication_invalid",
                "The pending rollback has no recorded commit",
            )
        })?
    } else {
        let head_before = GitCommands::commit_sha(checkout.root()).map_err(|_| {
            AppError::new(
                "workspace_needs_recovery",
                "The GitHub repository state could not be verified before rollback",
            )
        })?;
        if let Err(error) = GitCommands::run(
            checkout.root(),
            &["revert", "--no-edit", &record.commit_sha],
        ) {
            if matches!(error, GitCommandError::TimedOut) {
                reconcile_timed_out_revert(
                    publications,
                    batch_id,
                    checkout.root(),
                    &head_before,
                    &record.commit_sha,
                )?;
                return Err(AppError::new(
                    "git_timeout",
                    "GitHub rollback timed out. Check your network and try again.",
                ));
            }
            let _ = GitCommands::run(checkout.root(), &["revert", "--abort"]);
            return Err(AppError::new(
                "git_revert_failed",
                "The release commit could not be reverted",
            ));
        }
        let rollback_sha = GitCommands::commit_sha(checkout.root()).map_err(|_| {
            AppError::new(
                "git_revert_failed",
                "The rollback commit could not be identified",
            )
        })?;
        publications
            .mark_rollback_pending(batch_id, &rollback_sha)
            .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
        rollback_sha
    };
    crate::releases::push::execute(checkout.root())?;
    // Restore the last published baseline so the local source is detected as pending
    // again on the next scan. Legacy records have no saved baseline, so reset it.
    changes
        .restore_rollback(
            &record.scope_id,
            record.snapshots_before_publish.as_deref().unwrap_or(&[]),
        )
        .map_err(|_| AppError::new("storage_error", "Rollback state could not be saved"))?;
    publications
        .mark_rolled_back(
            batch_id,
            &rollback_sha,
            &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    Ok(rollback_sha)
}

fn reconcile_timed_out_revert(
    publications: &PublicationRepository,
    batch_id: &str,
    root: &std::path::Path,
    head_before: &str,
    reverted_commit: &str,
) -> AppResult<()> {
    let head_after = GitCommands::commit_sha(root).map_err(|_| recovery_error())?;
    if head_after != head_before && completed_revert_matches(root, head_before, reverted_commit) {
        crate::workspace::WorkingTree::require_clean(root).map_err(|_| recovery_error())?;
        publications
            .mark_rollback_pending(batch_id, &head_after)
            .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
        return Ok(());
    }
    let _ = GitCommands::run(root, &["revert", "--abort"]);
    crate::workspace::WorkingTree::require_clean(root).map_err(|_| recovery_error())
}

fn completed_revert_matches(
    root: &std::path::Path,
    head_before: &str,
    reverted_commit: &str,
) -> bool {
    let Ok(parent) = GitCommands::run(root, &["rev-parse", "HEAD^"]) else {
        return false;
    };
    if String::from_utf8_lossy(&parent.stdout).trim() != head_before {
        return false;
    }
    let Ok(message) = GitCommands::run(root, &["show", "--no-patch", "--format=%B", "HEAD"]) else {
        return false;
    };
    let expected_trailer = format!("This reverts commit {reverted_commit}.");
    String::from_utf8_lossy(&message.stdout).contains(&expected_trailer)
}

fn recovery_error() -> AppError {
    AppError::new(
        "workspace_needs_recovery",
        "The GitHub repository state could not be recovered after rollback timed out",
    )
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use crate::{
        scopes::scope::{Scope, ScopeLifecycle},
        sources::source::Source,
        storage::{
            publications::{PublicationRecord, PublicationRepository, PublicationState},
            scopes::ScopeRepository,
            sources::SourceRepository,
        },
    };

    use super::reconcile_timed_out_revert;

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
    fn records_a_revert_commit_completed_before_a_timeout_is_reported() {
        let root = std::env::temp_dir().join(format!("easyblog-rollback-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        git(&workspace, &["init"]);
        fs::write(workspace.join("post.md"), "initial\n").unwrap();
        git(&workspace, &["add", "post.md"]);
        git(
            &workspace,
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
        fs::write(workspace.join("post.md"), "published\n").unwrap();
        git(&workspace, &["add", "post.md"]);
        git(
            &workspace,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Publish easyBlog release",
            ],
        );
        let published_sha = crate::providers::git::GitCommands::commit_sha(&workspace).unwrap();

        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let publications = PublicationRepository::open(&database).unwrap();
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
                    target_id: Some("target".into()),
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
        publications
            .insert_pending(&PublicationRecord {
                batch_id: "batch".into(),
                scope_id: "scope".into(),
                target_id: "target".into(),
                commit_sha: published_sha.clone(),
                change_ids: vec![],
                snapshots_before_publish: None,
                state: PublicationState::PendingPush,
                published_at: None,
                rollback_commit_sha: None,
                rolled_back_at: None,
            })
            .unwrap();
        publications.mark_published("batch", "now").unwrap();

        git(&workspace, &["revert", "--no-edit", &published_sha]);
        let rollback_sha = crate::providers::git::GitCommands::commit_sha(&workspace).unwrap();

        reconcile_timed_out_revert(
            &publications,
            "batch",
            &workspace,
            &published_sha,
            &published_sha,
        )
        .unwrap();

        let record = publications.get("batch").unwrap().unwrap();
        assert_eq!(record.state, PublicationState::RollbackPending);
        assert_eq!(
            record.rollback_commit_sha.as_deref(),
            Some(rollback_sha.as_str())
        );

        drop(publications);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }
}
