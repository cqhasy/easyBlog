use chrono::{SecondsFormat, Utc};

use crate::{
    changes::change::ChangeKind,
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
) -> AppResult<()> {
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
    if record.state != PublicationState::PendingPush {
        return Err(AppError::new(
            "publication_not_retryable",
            "Only a release waiting to be pushed can be retried",
        ));
    }
    let pending = changes
        .list(&record.scope_id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))?;
    let selected =
        crate::actions::preview_release::select_pending_changes(&pending, &record.change_ids)?;
    // Validate before pushing. A later scan may replace change IDs, in which case
    // pushing this historical commit could no longer be finalized locally.
    let checkout = Checkout::acquire(target)
        .map_err(|_| AppError::new("target_unavailable", "The publishing target is not ready"))?;
    crate::releases::push::execute(checkout.root())?;
    let mut baseline = match record.snapshots_before_publish.clone() {
        Some(snapshots) => snapshots,
        None => changes
            .list_snapshots(&record.scope_id)
            .map_err(|_| AppError::new("storage_error", "Snapshots could not be loaded"))?,
    };
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
        .apply_publication(&record.scope_id, &baseline, &record.change_ids)
        .map_err(|_| AppError::new("storage_error", "Published state could not be saved"))?;
    publications
        .mark_published(
            batch_id,
            &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::{
        scopes::scope::{Scope, ScopeLifecycle},
        sources::source::Source,
        storage::{
            changes::ChangeRepository,
            publications::{PublicationRecord, PublicationRepository, PublicationState},
            scopes::ScopeRepository,
            sources::SourceRepository,
        },
        targets::Target,
    };

    use super::*;

    #[test]
    fn rejects_stale_pending_changes_before_acquiring_or_pushing_the_target() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("easyblog-retry-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
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
                commit_sha: "sha".into(),
                change_ids: vec!["stale-change".into()],
                snapshots_before_publish: Some(vec![]),
                state: PublicationState::PendingPush,
                published_at: None,
                rollback_commit_sha: None,
                rolled_back_at: None,
            })
            .unwrap();

        let error = execute(
            &changes,
            &publications,
            "batch",
            &Target::new("target", root.join("not-a-repository")),
        )
        .unwrap_err();

        assert_eq!(error.code, "change_not_found");
        assert_eq!(
            publications.get("batch").unwrap().unwrap().state,
            PublicationState::PendingPush
        );
        drop(publications);
        drop(changes);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }
}
