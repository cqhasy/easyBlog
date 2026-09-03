use serde::{Deserialize, Serialize};

use crate::shared::errors::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchState {
    Draft,
    Previewed,
    Committing,
    PendingPush,
    Published,
    RollbackPrepared,
    RollbackPending,
    RolledBack,
    Invalidated,
    RecoveryRequired,
    Legacy,
}

impl BatchState {
    pub fn transition_to(self, next: Self) -> AppResult<()> {
        let valid = matches!(
            (self, next),
            (Self::Draft, Self::Previewed | Self::Invalidated)
                | (Self::Previewed, Self::Committing | Self::Invalidated)
                | (Self::Committing, Self::PendingPush | Self::RecoveryRequired)
                | (Self::PendingPush, Self::Published | Self::RecoveryRequired)
                | (Self::Published, Self::RollbackPrepared)
                | (
                    Self::RollbackPrepared,
                    Self::RollbackPending | Self::RecoveryRequired
                )
                | (
                    Self::RollbackPending,
                    Self::RolledBack | Self::RecoveryRequired
                )
        );
        if valid {
            Ok(())
        } else {
            Err(AppError::new(
                "invalid_release_batch_transition",
                format!("Cannot transition release batch from {self:?} to {next:?}"),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BatchState;

    #[test]
    fn pending_push_cannot_return_to_previewed() {
        assert!(BatchState::PendingPush
            .transition_to(BatchState::Previewed)
            .is_err());
    }

    #[test]
    fn draft_can_be_invalidated_before_preview() {
        assert!(BatchState::Draft
            .transition_to(BatchState::Invalidated)
            .is_ok());
    }
}
