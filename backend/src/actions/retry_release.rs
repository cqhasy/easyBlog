use chrono::{SecondsFormat, Utc};

use crate::{
    releases::BatchState,
    shared::errors::{AppError, AppResult},
    storage::{
        changes::ChangeRepository, ledger::LedgerRepository, publications::PublicationRepository,
    },
    targets::Target,
    workspace::Checkout,
};

pub fn execute(
    changes: &ChangeRepository,
    ledger: &LedgerRepository,
    publications: &PublicationRepository,
    batch_id: &str,
    target: &Target,
) -> AppResult<()> {
    let batch = ledger
        .load_batch(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release batch could not be loaded"))?
        .ok_or_else(|| {
            AppError::new("publication_not_found", "This publication no longer exists")
        })?;
    if batch.target_id != target.id {
        return Err(AppError::new(
            "target_mismatch",
            "The selected target does not match this publication",
        ));
    }
    let commit_sha = match batch.state {
        BatchState::PendingPush => batch.commit_sha,
        BatchState::RollbackPending => batch.rollback_commit_sha,
        _ => {
            return Err(AppError::new(
                "publication_not_retryable",
                "Only a release waiting to be pushed can be retried",
            ));
        }
    }
    .ok_or_else(|| {
        AppError::new(
            "publication_invalid",
            "The pending publication has no recorded commit",
        )
    })?;
    let checkout = Checkout::acquire_pending_push(target, &commit_sha)
        .map_err(crate::actions::preview_release::checkout_error)?;
    if batch.state == BatchState::RollbackPending {
        publications
            .mark_rollback_pending(batch_id, &commit_sha)
            .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    }
    crate::releases::push::execute(checkout.root())?;
    let at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    match batch.state {
        BatchState::PendingPush => {
            let transitions = ledger.load_source_transitions(batch_id).map_err(|_| {
                AppError::new("storage_error", "Release source state could not be loaded")
            })?;
            changes
                .finalize_release_baselines(&batch.scope_id, &transitions)
                .map_err(|_| {
                    AppError::new("storage_error", "Published state could not be saved")
                })?;
            publications.mark_published(batch_id, &at).map_err(|_| {
                AppError::new("storage_error", "Release history could not be updated")
            })?;
            ledger
                .finalize_publish(batch_id, &commit_sha, &at)
                .map_err(|_| {
                    AppError::new("storage_error", "Release ledger could not be finalized")
                })
        }
        BatchState::RollbackPending => {
            let transitions = ledger.load_source_transitions(batch_id).map_err(|_| {
                AppError::new("storage_error", "Release source state could not be loaded")
            })?;
            changes
                .restore_release_baselines(&batch.scope_id, &transitions)
                .map_err(|_| {
                    AppError::new("storage_error", "Rollback source state could not be saved")
                })?;
            publications
                .mark_rolled_back(batch_id, &commit_sha, &at)
                .map_err(|_| {
                    AppError::new("storage_error", "Release history could not be updated")
                })?;
            ledger
                .finalize_rollback(batch_id, &commit_sha, &at)
                .map_err(|_| {
                    AppError::new("storage_error", "Release ledger could not be finalized")
                })
        }
        _ => unreachable!(),
    }
}
