use std::path::Path;

use crate::providers::git::{
    GitCommandError, GitCommands, GitParser, StatusEntry, StatusParseError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkingTreeError {
    Git(GitCommandError),
    InvalidStatus(StatusParseError),
    Dirty { entries: Vec<StatusEntry> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkingTree {
    pub entries: Vec<StatusEntry>,
}

impl WorkingTree {
    pub fn inspect(root: &Path) -> Result<Self, WorkingTreeError> {
        let status = GitCommands::status_porcelain(root).map_err(WorkingTreeError::Git)?;
        let entries =
            GitParser::parse_status_porcelain(&status).map_err(WorkingTreeError::InvalidStatus)?;
        Ok(Self { entries })
    }

    pub fn require_clean(root: &Path) -> Result<(), WorkingTreeError> {
        let tree = Self::inspect(root)?;
        if tree.entries.is_empty() {
            Ok(())
        } else {
            Err(WorkingTreeError::Dirty {
                entries: tree.entries,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, process::Command};

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
    fn reports_external_worktree_edits_without_changing_the_repository() {
        let root =
            std::env::temp_dir().join(format!("easyblog-working-tree-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        git(&root, &["init"]);
        fs::write(root.join("post.md"), "first\n").unwrap();
        git(&root, &["add", "post.md"]);
        git(
            &root,
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
        fs::write(root.join("post.md"), "external edit\n").unwrap();

        assert!(matches!(
            WorkingTree::require_clean(&root),
            Err(WorkingTreeError::Dirty { entries }) if entries.len() == 1 && entries[0].path == "post.md"
        ));
        assert_eq!(
            fs::read_to_string(root.join("post.md")).unwrap(),
            "external edit\n"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
