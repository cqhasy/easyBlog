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
        if target.state == TargetState::Ready && !target.default_branch.is_empty() {
            synchronize(target.path(), &target.default_branch)?;
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

fn synchronize(root: &Path, default_branch: &str) -> Result<(), CheckoutError> {
    run(root, &["fetch", "--prune", "origin"])?;
    let current_branch = run(root, &["branch", "--show-current"])?;
    if String::from_utf8_lossy(&current_branch.stdout).trim() != default_branch {
        return Err(CheckoutError::Synchronization);
    }
    let remote_branch = format!("origin/{default_branch}");
    let relation = run(
        root,
        &[
            "rev-list",
            "--left-right",
            "--count",
            "HEAD...",
            &remote_branch,
        ],
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
        run(root, &["merge", "--ff-only", &remote_branch])?;
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

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use super::*;

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn rejects_a_clean_workspace_checked_out_to_a_non_default_branch() {
        let root = std::env::temp_dir().join(format!("easyblog-checkout-{}", uuid::Uuid::new_v4()));
        let remote = root.join("remote.git");
        let seed = root.join("seed");
        let workspace = root.join("workspace");
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "--bare", remote.to_str().unwrap()]);
        fs::create_dir(&seed).unwrap();
        git(&seed, &["init", "--initial-branch=main"]);
        fs::create_dir(seed.join("_posts")).unwrap();
        fs::write(seed.join("_posts/.gitkeep"), "").unwrap();
        fs::write(seed.join("post.md"), "initial\n").unwrap();
        git(&seed, &["add", "post.md", "_posts/.gitkeep"]);
        git(
            &seed,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial commit",
            ],
        );
        git(
            &seed,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        git(&seed, &["push", "-u", "origin", "main"]);
        let output = Command::new("git")
            .args([
                "--git-dir",
                remote.to_str().unwrap(),
                "symbolic-ref",
                "HEAD",
                "refs/heads/main",
            ])
            .output()
            .unwrap();
        assert!(output.status.success());
        git(
            &root,
            &[
                "clone",
                remote.to_str().unwrap(),
                workspace.to_str().unwrap(),
            ],
        );
        git(&workspace, &["switch", "-c", "preview"]);

        let mut target = Target::new("target-1", &workspace);
        target.repository = "owner/blog".into();
        target.default_branch = "main".into();
        target.state = TargetState::Ready;

        assert!(matches!(
            Checkout::acquire(&target),
            Err(CheckoutError::Synchronization)
        ));

        fs::remove_dir_all(root).unwrap();
    }
}
