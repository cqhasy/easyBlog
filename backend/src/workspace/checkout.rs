use std::path::{Path, PathBuf};

use crate::{
    diagnostics::{logging, redaction},
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
    Synchronization(SynchronizationError),
}

#[derive(Debug, PartialEq, Eq)]
pub enum SynchronizationError {
    GitUnavailable,
    GitCommandFailed {
        arguments: Vec<String>,
        stderr: String,
    },
    UnexpectedBranch {
        expected: String,
        actual: String,
    },
    UnexpectedHead {
        expected: String,
        actual: String,
    },
    Diverged {
        local_ahead: u32,
        remote_ahead: u32,
    },
    InvalidRelation {
        output: String,
    },
    UnexpectedPendingCommit {
        expected_parent: String,
        remote_head: String,
    },
}

impl SynchronizationError {
    pub fn user_message(&self) -> String {
        match self {
            Self::GitUnavailable => "Git could not be started while synchronizing the target".into(),
            Self::GitCommandFailed { arguments, stderr } => git_command_message(arguments, stderr),
            Self::UnexpectedBranch { expected, actual } => format!(
                "The target workspace is on branch \"{actual}\" instead of configured branch \"{expected}\""
            ),
            Self::UnexpectedHead { .. } => {
                "The release preview no longer matches the current target commit".into()
            }
            Self::Diverged {
                local_ahead,
                remote_ahead,
            } => format!(
                "The target branch differs from GitHub (local ahead: {local_ahead}, remote ahead: {remote_ahead})"
            ),
            Self::InvalidRelation { .. } => {
                "Git returned an invalid branch comparison result. Check the easyBlog log for details.".into()
            }
            Self::UnexpectedPendingCommit { .. } => {
                "The pending release commit is not based on the current GitHub branch".into()
            }
        }
    }
}

fn git_command_message(arguments: &[String], stderr: &str) -> String {
    let command = arguments.join(" ");
    let detail = redaction::redact(stderr);
    if detail.contains("Failed to connect to github.com port 443") {
        return "Could not connect to GitHub (github.com:443 timed out). Check your network or proxy, then retry.".into();
    }
    if detail.contains("Authentication failed") || detail.contains("could not read Username") {
        return "GitHub authentication failed while synchronizing the target. Reconnect GitHub, then retry.".into();
    }
    let detail = detail
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Git returned no error details");
    format!(
        "Git command \"{command}\" failed: {}",
        truncate_detail(detail)
    )
}

fn truncate_detail(detail: &str) -> &str {
    const MAX_DETAIL_LENGTH: usize = 240;
    if detail.len() <= MAX_DETAIL_LENGTH {
        detail
    } else {
        let end = detail
            .char_indices()
            .take_while(|(index, _)| *index <= MAX_DETAIL_LENGTH)
            .map(|(index, character)| index + character.len_utf8())
            .take_while(|index| *index <= MAX_DETAIL_LENGTH)
            .last()
            .unwrap_or_default();
        &detail[..end]
    }
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
    logging::info(
        "git-sync",
        format!(
            "workspace={} operation=pending-push-sync default_branch={} expected_commit={}",
            root.display(),
            default_branch,
            expected_commit
        ),
    );
    run(root, &["fetch", "--prune", "origin"])?;
    let current_branch = output_text(run(root, &["branch", "--show-current"])?);
    if current_branch != default_branch {
        return Err(synchronization_failure(
            root,
            SynchronizationError::UnexpectedBranch {
                expected: default_branch.into(),
                actual: display_branch(&current_branch),
            },
        ));
    }
    let head = output_text(run(root, &["rev-parse", "HEAD"])?);
    if head != expected_commit {
        return Err(synchronization_failure(
            root,
            SynchronizationError::UnexpectedHead {
                expected: expected_commit.into(),
                actual: head,
            },
        ));
    }
    let remote_branch = format!("origin/{default_branch}");
    let range = format!("HEAD...{remote_branch}");
    let relation = output_text(run(root, &["rev-list", "--left-right", "--count", &range])?);
    let counts = parse_relation(root, &relation)?;
    logging::info(
        "git-sync",
        format!(
            "workspace={} operation=pending-push-sync local_ahead={} remote_ahead={}",
            root.display(),
            counts[0],
            counts[1]
        ),
    );
    if counts == [0, 0] {
        return Ok(());
    }
    if counts != [1, 0] {
        return Err(synchronization_failure(
            root,
            SynchronizationError::Diverged {
                local_ahead: counts[0],
                remote_ahead: counts[1],
            },
        ));
    }
    let parent = output_text(run(root, &["rev-parse", "HEAD^"])?);
    let remote = output_text(run(root, &["rev-parse", &remote_branch])?);
    if parent != remote {
        return Err(synchronization_failure(
            root,
            SynchronizationError::UnexpectedPendingCommit {
                expected_parent: parent,
                remote_head: remote,
            },
        ));
    }
    Ok(())
}

fn synchronize(root: &Path, default_branch: &str) -> Result<(), CheckoutError> {
    logging::info(
        "git-sync",
        format!(
            "workspace={} operation=sync default_branch={}",
            root.display(),
            default_branch
        ),
    );
    run(root, &["fetch", "--prune", "origin"])?;
    let current_branch = output_text(run(root, &["branch", "--show-current"])?);
    if current_branch != default_branch {
        return Err(synchronization_failure(
            root,
            SynchronizationError::UnexpectedBranch {
                expected: default_branch.into(),
                actual: display_branch(&current_branch),
            },
        ));
    }
    let remote_branch = format!("origin/{default_branch}");
    let range = format!("HEAD...{remote_branch}");
    let relation = output_text(run(root, &["rev-list", "--left-right", "--count", &range])?);
    let counts = parse_relation(root, &relation)?;
    logging::info(
        "git-sync",
        format!(
            "workspace={} operation=sync local_ahead={} remote_ahead={}",
            root.display(),
            counts[0],
            counts[1]
        ),
    );
    if counts[0] > 0 {
        return Err(synchronization_failure(
            root,
            SynchronizationError::Diverged {
                local_ahead: counts[0],
                remote_ahead: counts[1],
            },
        ));
    }
    if counts[1] > 0 {
        run(root, &["merge", "--ff-only", &remote_branch])?;
    }
    Ok(())
}

fn run(root: &Path, arguments: &[&str]) -> Result<GitOutput, CheckoutError> {
    let output = GitCommands::run(root, arguments).map_err(|error| match error {
        GitCommandError::TimedOut => CheckoutError::TimedOut,
        GitCommandError::Unavailable => {
            synchronization_failure(root, SynchronizationError::GitUnavailable)
        }
        GitCommandError::Failed { arguments, stderr } => synchronization_failure(
            root,
            SynchronizationError::GitCommandFailed { arguments, stderr },
        ),
    })?;
    Ok(output)
}

fn parse_relation(root: &Path, output: &str) -> Result<Vec<u32>, CheckoutError> {
    let counts = output
        .split_whitespace()
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>();
    match counts {
        Ok(counts) if counts.len() == 2 => Ok(counts),
        _ => Err(synchronization_failure(
            root,
            SynchronizationError::InvalidRelation {
                output: output.into(),
            },
        )),
    }
}

fn output_text(output: GitOutput) -> String {
    String::from_utf8_lossy(&output.stdout).trim().into()
}

fn display_branch(branch: &str) -> String {
    if branch.is_empty() {
        "<detached HEAD>".into()
    } else {
        branch.into()
    }
}

fn synchronization_failure(root: &Path, error: SynchronizationError) -> CheckoutError {
    let details = redaction::redact(&format!(
        "workspace={} synchronization_error={error:?}",
        root.display()
    ));
    logging::error("git-sync", details);
    CheckoutError::Synchronization(error)
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
            Err(CheckoutError::Synchronization(
                SynchronizationError::UnexpectedBranch { .. }
            ))
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
            Err(CheckoutError::Synchronization(
                SynchronizationError::UnexpectedHead { .. }
            ))
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_push_accepts_the_expected_commit_already_on_the_remote() {
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
        git(&workspace, &["push"]);
        let mut target = Target::new("target", &workspace);
        target.repository = "owner/blog".into();
        target.default_branch = "main".into();
        target.state = TargetState::Ready;
        target.adapter = Some(crate::targets::PublishingAdapter::GithubPages);

        assert!(Checkout::acquire_pending_push(&target, &expected).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn truncates_error_detail_without_splitting_utf8_characters() {
        let detail = format!("{}中", "a".repeat(239));

        assert_eq!(truncate_detail(&detail), "a".repeat(239));
    }
}
