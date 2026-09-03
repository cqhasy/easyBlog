use chrono::{SecondsFormat, Utc};

use crate::{
    releases::{commit, stage, BatchState, ContentHash, FileSet},
    shared::errors::{AppError, AppResult},
    storage::{
        changes::ChangeRepository,
        ledger::{LedgerRepository, ReleaseConflict},
        publications::PublicationRepository,
    },
    targets::Target,
    workspace::{Checkout, GitObjectStore},
};

pub fn execute(
    changes: &ChangeRepository,
    ledger: &LedgerRepository,
    publications: &PublicationRepository,
    batch_id: &str,
    target: &Target,
) -> AppResult<String> {
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
    if batch.state == BatchState::RollbackPending {
        let commit = batch.rollback_commit_sha.ok_or_else(|| {
            AppError::new(
                "publication_invalid",
                "The pending rollback has no recorded commit",
            )
        })?;
        crate::actions::retry_release::execute(changes, ledger, publications, batch_id, target)?;
        restore_source_baselines(changes, ledger, batch_id, &batch.scope_id)?;
        return Ok(commit);
    }
    if batch.state == BatchState::Legacy {
        return Err(AppError::new(
            "publication_legacy_rollback_unsupported",
            "This legacy publication cannot be rolled back safely",
        ));
    }
    if batch.state != BatchState::Published {
        return Err(AppError::new(
            "publication_not_reversible",
            "Only a published release can be rolled back",
        ));
    }
    let checkout =
        Checkout::acquire(target).map_err(crate::actions::preview_release::checkout_error)?;
    let operations = ledger
        .load_operations(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release operations could not be loaded"))?;
    if operations.is_empty() {
        let _ = ledger.mark_recovery_required(batch_id, "missing_operation_ledger");
        return Err(AppError::new(
            "publication_legacy_rollback_unsupported",
            "This publication has no reversible operation ledger",
        ));
    }
    let conflicts = operations
        .iter()
        .filter_map(|entry| {
            let actual =
                ContentHash::read(&checkout.root().join(&entry.operation.target_path)).ok()?;
            (actual != entry.operation.after_hash).then(|| ReleaseConflict {
                id: uuid::Uuid::new_v4().to_string(),
                target_path: entry.operation.target_path.clone(),
                code: "target_external_change".into(),
                expected_hash: entry.operation.after_hash.clone(),
                actual_hash: actual,
                created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            })
        })
        .collect::<Vec<_>>();
    if !conflicts.is_empty() {
        let _ = ledger.record_conflicts(batch_id, &conflicts);
        return Err(AppError::new(
            "target_external_change",
            "One or more published target files changed after release",
        ));
    }
    if !ledger
        .acquire_target_mutation(&target.id, batch_id)
        .map_err(|_| AppError::new("storage_error", "Target release state could not be claimed"))?
        || !ledger
            .begin_rollback(batch_id)
            .map_err(|_| AppError::new("storage_error", "Rollback could not be started"))?
    {
        return Err(AppError::new(
            "publication_not_reversible",
            "Another target operation is already active",
        ));
    }
    let commit_sha = batch.commit_sha.ok_or_else(|| {
        AppError::new(
            "publication_invalid",
            "The published release has no recorded commit",
        )
    })?;
    let objects = GitObjectStore::new(checkout.root(), commit_sha);
    let mut inverse = FileSet::default();
    for entry in operations.iter().rev() {
        inverse
            .insert(entry.operation.inverse(&objects)?)
            .map_err(|_| {
                AppError::new(
                    "release_plan_invalid",
                    "Rollback contains duplicate target paths",
                )
            })?;
    }
    stage::apply(checkout.root(), &inverse)?;
    let rollback_sha = commit::create(checkout.root(), "Rollback easyBlog release")?;
    ledger
        .mark_rollback_pending(batch_id, &rollback_sha)
        .map_err(|_| AppError::new("storage_error", "Rollback commit could not be recorded"))?;
    crate::releases::push::execute(checkout.root())?;
    ledger
        .finalize_rollback(
            batch_id,
            &rollback_sha,
            &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .map_err(|_| AppError::new("storage_error", "Release ledger could not be finalized"))?;
    publications
        .mark_rolled_back(
            batch_id,
            &rollback_sha,
            &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    restore_source_baselines(changes, ledger, batch_id, &batch.scope_id)?;
    Ok(rollback_sha)
}

fn restore_source_baselines(
    changes: &ChangeRepository,
    ledger: &LedgerRepository,
    batch_id: &str,
    scope_id: &str,
) -> AppResult<()> {
    let transitions = ledger
        .load_source_transitions(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release source state could not be loaded"))?;
    changes
        .restore_release_baselines(scope_id, &transitions)
        .map_err(|_| AppError::new("storage_error", "Rollback source state could not be saved"))
}
