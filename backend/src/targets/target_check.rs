use std::{path::Path, process::Command};

use super::{layout::PagesLayout, target::Target};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetCheck {
    Ready { needs_configuration: bool },
    NeedsInitialization,
    Unsupported { reason: TargetCheckError },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetCheckError {
    MissingWorkspace,
    NotDirectory,
    NotGitRepository,
    MissingPostsDirectory { path: String },
    InvalidLayoutPath { path: String },
}

pub fn check(target: &Target) -> TargetCheck {
    let root = target.path();
    if !root.exists() {
        return TargetCheck::Unsupported {
            reason: TargetCheckError::MissingWorkspace,
        };
    }
    if !root.is_dir() {
        return TargetCheck::Unsupported {
            reason: TargetCheckError::NotDirectory,
        };
    }
    if !is_git_workspace(root) {
        return TargetCheck::Unsupported {
            reason: TargetCheckError::NotGitRepository,
        };
    }
    if let Err(error) = validate_layout(root, &target.layout) {
        if matches!(error, TargetCheckError::MissingPostsDirectory { .. }) {
            return TargetCheck::NeedsInitialization;
        }
        return TargetCheck::Unsupported { reason: error };
    }
    TargetCheck::Ready {
        needs_configuration: false,
    }
}

fn is_git_workspace(root: &Path) -> bool {
    let Ok(output) = Command::new("git")
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .arg("--show-toplevel")
        .current_dir(root)
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    if lines.next() != Some("true") {
        return false;
    }
    let Some(top_level) = lines.next() else {
        return false;
    };
    let Ok(top_level) = std::fs::canonicalize(top_level) else {
        return false;
    };
    std::fs::canonicalize(root).is_ok_and(|selected_root| selected_root == top_level)
}

fn validate_layout(root: &Path, layout: &PagesLayout) -> Result<(), TargetCheckError> {
    for path in [&layout.posts_directory, &layout.resources_directory] {
        if !PagesLayout::is_safe_relative_path(path) {
            return Err(TargetCheckError::InvalidLayoutPath {
                path: path.display().to_string(),
            });
        }
    }
    let posts_directory = root.join(&layout.posts_directory);
    if !posts_directory.is_dir() {
        return Err(TargetCheckError::MissingPostsDirectory {
            path: layout.posts_directory.display().to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use super::*;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let suffix = uuid::Uuid::new_v4();
        std::env::temp_dir().join(format!("easyblog-target-check-{name}-{suffix}"))
    }

    fn target(root: &Path) -> Target {
        Target::new("target-1", root)
    }

    fn git(directory: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(directory)
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
    fn validates_supported_repository_and_reports_missing_config() {
        let root = temporary_directory("ready");
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        fs::create_dir_all(root.join("_posts")).unwrap();

        assert_eq!(
            check(&target(&root)),
            TargetCheck::Ready {
                needs_configuration: false
            }
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_repositories_and_unsupported_layouts() {
        let root = temporary_directory("invalid");
        fs::create_dir_all(&root).unwrap();
        assert_eq!(
            check(&target(&root)),
            TargetCheck::Unsupported {
                reason: TargetCheckError::NotGitRepository
            }
        );

        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("_posts")).unwrap();
        assert_eq!(
            check(&target(&root)),
            TargetCheck::Unsupported {
                reason: TargetCheckError::NotGitRepository
            }
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn accepts_a_linked_git_worktree_at_the_selected_root() {
        let primary = temporary_directory("primary");
        let worktree = temporary_directory("linked");
        fs::create_dir_all(&primary).unwrap();
        git(&primary, &["init"]);
        fs::write(primary.join("README.md"), "# Test\n").unwrap();
        git(&primary, &["add", "README.md"]);
        git(
            &primary,
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
            &primary,
            &[
                "worktree",
                "add",
                "-b",
                "target-check-linked",
                worktree.to_str().unwrap(),
            ],
        );
        fs::create_dir(worktree.join("_posts")).unwrap();

        assert_eq!(
            check(&target(&worktree)),
            TargetCheck::Ready {
                needs_configuration: false
            }
        );

        git(
            &primary,
            &["worktree", "remove", "--force", worktree.to_str().unwrap()],
        );
        fs::remove_dir_all(primary).unwrap();
    }
}
