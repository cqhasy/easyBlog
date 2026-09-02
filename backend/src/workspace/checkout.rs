use std::path::{Path, PathBuf};

use crate::{
    targets::{check, Target, TargetCheck},
    workspace::{
        file_lock::{FileLock, FileLockError},
        working_tree::{WorkingTree, WorkingTreeError},
    },
};

#[derive(Debug)]
pub enum CheckoutError {
    UnsupportedTarget(TargetCheck),
    Lock(FileLockError),
    WorkingTree(WorkingTreeError),
}

pub struct Checkout {
    root: PathBuf,
    _lock: FileLock,
}

impl Checkout {
    pub fn acquire(target: &Target) -> Result<Self, CheckoutError> {
        match check(target) {
            TargetCheck::Ready { .. } => {}
            result => return Err(CheckoutError::UnsupportedTarget(result)),
        }
        let lock = FileLock::acquire(target.path()).map_err(CheckoutError::Lock)?;
        WorkingTree::require_clean(target.path()).map_err(CheckoutError::WorkingTree)?;
        Ok(Self {
            root: target.path().to_owned(),
            _lock: lock,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}
