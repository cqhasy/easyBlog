use chrono::{SecondsFormat, Utc};

use crate::{
    shared::errors::{AppError, AppResult},
    storage::publications::{PublicationRepository, PublicationState},
    targets::Target,
    workspace::Checkout,
};

pub fn execute(
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
        if let Err(error) = crate::providers::git::GitCommands::run(
            checkout.root(),
            &["revert", "--no-edit", &record.commit_sha],
        ) {
            let _ =
                crate::providers::git::GitCommands::run(checkout.root(), &["revert", "--abort"]);
            if matches!(error, crate::providers::git::GitCommandError::TimedOut) {
                return Err(AppError::new(
                    "git_timeout",
                    "GitHub rollback timed out. Check your network and try again.",
                ));
            }
            return Err(AppError::new(
                "git_revert_failed",
                "The release commit could not be reverted",
            ));
        }
        let rollback_sha = crate::providers::git::GitCommands::commit_sha(checkout.root())
            .map_err(|_| {
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
    publications
        .mark_rolled_back(
            batch_id,
            &rollback_sha,
            &Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .map_err(|_| AppError::new("storage_error", "Release history could not be updated"))?;
    Ok(rollback_sha)
}
