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
    let checkout = Checkout::acquire(target)
        .map_err(|_| AppError::new("target_unavailable", "The publishing target is not ready"))?;
    crate::releases::push::execute(checkout.root())?;
    let pending = changes
        .list(&record.scope_id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))?;
    let selected =
        crate::actions::preview_release::select_pending_changes(&pending, &record.change_ids)?;
    let mut baseline = changes
        .list_snapshots(&record.scope_id)
        .map_err(|_| AppError::new("storage_error", "Snapshots could not be loaded"))?;
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
