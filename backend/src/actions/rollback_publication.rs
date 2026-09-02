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
    if record.state != PublicationState::Published {
        return Err(AppError::new(
            "publication_not_reversible",
            "Only a published release can be rolled back",
        ));
    }
    let checkout = Checkout::acquire(target)
        .map_err(|_| AppError::new("target_unavailable", "The publishing target is not ready"))?;
    crate::providers::git::GitCommands::run(
        checkout.root(),
        &["revert", "--no-edit", &record.commit_sha],
    )
    .map_err(|_| {
        AppError::new(
            "git_revert_failed",
            "The release commit could not be reverted",
        )
    })?;
    let rollback_sha =
        crate::providers::git::GitCommands::commit_sha(checkout.root()).map_err(|_| {
            AppError::new(
                "git_revert_failed",
                "The rollback commit could not be identified",
            )
        })?;
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
