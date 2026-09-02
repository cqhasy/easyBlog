use std::{
    path::{Path, PathBuf},
    process::Command,
};

use crate::{
    targets::{check, Target, TargetCheck, TargetState},
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
    Synchronization,
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
        if target.state == TargetState::Ready {
            synchronize(target.path())?;
        }
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

fn synchronize(root: &Path) -> Result<(), CheckoutError> {
    run(root, &["fetch", "--prune", "origin"])?;
    let relation = run(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )?;
    let counts = String::from_utf8_lossy(&relation.stdout)
        .split_whitespace()
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CheckoutError::Synchronization)?;
    if counts.len() != 2 || counts[0] > 0 {
        return Err(CheckoutError::Synchronization);
    }
    if counts[1] > 0 {
        run(root, &["merge", "--ff-only", "@{upstream}"])?;
    }
    Ok(())
}

fn run(root: &Path, arguments: &[&str]) -> Result<std::process::Output, CheckoutError> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .map_err(|_| CheckoutError::Synchronization)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(CheckoutError::Synchronization)
    }
}
