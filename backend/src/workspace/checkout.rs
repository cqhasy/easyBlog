use std::path::{Path, PathBuf};

use crate::{
    providers::git::{GitCommandError, GitCommands, GitOutput},
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
    TimedOut,
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

    pub fn acquire_pending_push(
        target: &Target,
        expected_commit: &str,
    ) -> Result<Self, CheckoutError> {
        match check(target) {
            TargetCheck::Ready { .. } => {}
            result => return Err(CheckoutError::UnsupportedTarget(result)),
        }
        let lock = FileLock::acquire(target.path()).map_err(CheckoutError::Lock)?;
        WorkingTree::require_clean(target.path()).map_err(CheckoutError::WorkingTree)?;
        if target.state == TargetState::Ready && !target.default_branch.is_empty() {
            synchronize_pending_push(target.path(), &target.default_branch, expected_commit)?;
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

fn synchronize_pending_push(
    root: &Path,
    default_branch: &str,
    expected_commit: &str,
) -> Result<(), CheckoutError> {
    run(root, &["fetch", "--prune", "origin"])?;
    let current_branch = run(root, &["branch", "--show-current"])?;
    if String::from_utf8_lossy(&current_branch.stdout).trim() != default_branch {
        return Err(CheckoutError::Synchronization);
    }
    let head = run(root, &["rev-parse", "HEAD"])?;
    if String::from_utf8_lossy(&head.stdout).trim() != expected_commit {
        return Err(CheckoutError::Synchronization);
    }
    let remote_branch = format!("origin/{default_branch}");
    let range = format!("HEAD...{remote_branch}");
    let relation = run(root, &["rev-list", "--left-right", "--count", &range])?;
    let counts = String::from_utf8_lossy(&relation.stdout)
        .split_whitespace()
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CheckoutError::Synchronization)?;
    if counts != [1, 0] {
        return Err(CheckoutError::Synchronization);
    }
    let parent = run(root, &["rev-parse", "HEAD^"])?;
    let remote = run(root, &["rev-parse", &remote_branch])?;
    if parent.stdout != remote.stdout {
        return Err(CheckoutError::Synchronization);
    }
    Ok(())
}

fn synchronize(root: &Path, default_branch: &str) -> Result<(), CheckoutError> {
    run(root, &["fetch", "--prune", "origin"])?;
    let current_branch = run(root, &["branch", "--show-current"])?;
    if String::from_utf8_lossy(&current_branch.stdout).trim() != default_branch {
        return Err(CheckoutError::Synchronization);
    }
    let remote_branch = format!("origin/{default_branch}");
    let range = format!("HEAD...{remote_branch}");
    let relation = run(root, &["rev-list", "--left-right", "--count", &range])?;
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

fn run(root: &Path, arguments: &[&str]) -> Result<GitOutput, CheckoutError> {
    let output = GitCommands::run(root, arguments).map_err(|error| match error {
        GitCommandError::TimedOut => CheckoutError::TimedOut,
        _ => CheckoutError::Synchronization,
    })?;
    Ok(output)
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

    #[test]
    fn pending_push_accepts_only_the_expected_single_ahead_commit() {
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
        git(&seed, &["add", "."]);
        git(
            &seed,
            &[
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial",
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
        fs::write(workspace.join("post.md"), "release\n").unwrap();
        git(&workspace, &["add", "."]);
        git(
            &workspace,
            &[
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Release",
            ],
        );
        let expected = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&workspace)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_owned();
        let mut target = Target::new("target", &workspace);
        target.repository = "owner/blog".into();
        target.default_branch = "main".into();
        target.state = TargetState::Ready;
        target.adapter = Some(crate::targets::PublishingAdapter::GithubPages);

        let pending = Checkout::acquire_pending_push(&target, &expected);
        if let Err(error) = pending {
            panic!("{error:?}");
        }
        drop(pending);
        assert!(matches!(
            Checkout::acquire_pending_push(&target, "not-the-commit"),
            Err(CheckoutError::Synchronization)
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
