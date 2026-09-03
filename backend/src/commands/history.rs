use crate::{
    actions,
    app::state::AppState,
    releases::BatchState,
    shared::errors::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use tauri::State;

#[tauri::command]
pub fn list_publications(state: State<'_, AppState>) -> AppResult<Vec<HistoryRecord>> {
    let publications = state
        .publications
        .list()
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))?;
    publications
        .into_iter()
        .map(|publication| {
            let batch = state
                .ledger
                .load_batch(&publication.batch_id)
                .map_err(|_| {
                    AppError::new("storage_error", "Release history could not be loaded")
                })?;
            let (state, recovery_reason, rollback_available) = match batch {
                Some(batch) => history_status(
                    batch.state,
                    batch.failure_code,
                    !state
                        .ledger
                        .load_operations(&publication.batch_id)
                        .map_err(|_| {
                            AppError::new("storage_error", "Release history could not be loaded")
                        })?
                        .is_empty(),
                ),
                None => (
                    "legacy",
                    Some("This older publication has no immutable operation ledger.".into()),
                    false,
                ),
            };
            Ok(HistoryRecord {
                batch_id: publication.batch_id,
                commit_sha: publication.commit_sha,
                scope_id: publication.scope_id,
                target_id: publication.target_id,
                change_ids: publication.change_ids,
                state: state.into(),
                published_at: publication.published_at,
                rollback_commit_sha: publication.rollback_commit_sha,
                rolled_back_at: publication.rolled_back_at,
                rollback_available,
                recovery_reason,
            })
        })
        .collect()
}

#[derive(Debug, Serialize)]
pub struct HistoryRecord {
    pub batch_id: String,
    pub commit_sha: String,
    pub scope_id: String,
    pub target_id: String,
    pub change_ids: Vec<String>,
    pub state: String,
    pub published_at: Option<String>,
    pub rollback_commit_sha: Option<String>,
    pub rolled_back_at: Option<String>,
    pub rollback_available: bool,
    pub recovery_reason: Option<String>,
}

fn history_status(
    state: BatchState,
    failure_code: Option<String>,
    has_operations: bool,
) -> (&'static str, Option<String>, bool) {
    match state {
        BatchState::Legacy => (
            "legacy",
            Some("This older publication has no immutable operation ledger.".into()),
            false,
        ),
        BatchState::RecoveryRequired => ("recovery_required", failure_code, false),
        BatchState::Published => ("published", None, has_operations),
        BatchState::PendingPush => ("pending_push", None, false),
        BatchState::RollbackPending => ("rollback_pending", None, false),
        BatchState::RolledBack => ("rolled_back", None, false),
        _ => (
            "recovery_required",
            Some("This release is not in a recoverable history state.".into()),
            false,
        ),
    }
}

#[derive(Debug, Deserialize)]
pub struct PublicationCommandInput {
    pub batch_id: String,
}

#[tauri::command]
pub async fn retry_release(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<()> {
    let ledger = state.ledger.clone();
    let changes = state.changes.clone();
    let publications = state.publications.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let target = target_for_publication(&ledger, &targets, &input.batch_id)?;
        actions::retry_release::execute(&changes, &ledger, &publications, &input.batch_id, &target)
    })
    .await
    .map_err(|_| AppError::new("retry_task_failed", "Release retry could not be completed"))?
}

#[tauri::command]
pub async fn rollback_publication(
    state: State<'_, AppState>,
    input: PublicationCommandInput,
) -> AppResult<String> {
    let changes = state.changes.clone();
    let ledger = state.ledger.clone();
    let publications = state.publications.clone();
    let targets = state.targets.clone();
    tauri::async_runtime::spawn_blocking(move || {
        actions::github_auth::require_ready()?;
        let target = target_for_publication(&ledger, &targets, &input.batch_id)?;
        actions::rollback_publication::execute(
            &changes,
            &ledger,
            &publications,
            &input.batch_id,
            &target,
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "rollback_task_failed",
            "Publication rollback could not be completed",
        )
    })?
}

fn target_for_publication(
    ledger: &crate::storage::ledger::LedgerRepository,
    targets: &crate::storage::targets::TargetRepository,
    batch_id: &str,
) -> AppResult<crate::targets::Target> {
    let publication = ledger
        .load_batch(batch_id)
        .map_err(|_| AppError::new("storage_error", "Release history could not be loaded"))?
        .ok_or_else(|| {
            AppError::new("publication_not_found", "This publication no longer exists")
        })?;
    targets
        .get(&publication.target_id)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be loaded"))?
        .map(|connected| connected.target)
        .ok_or_else(|| AppError::new("target_not_found", "The publishing target no longer exists"))
}
