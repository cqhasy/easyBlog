use std::path::Path;

use super::{layout::PagesLayout, target::Target};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetCheck {
    Ready { needs_configuration: bool },
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
    if !root.join(".git").exists() {
        return TargetCheck::Unsupported {
            reason: TargetCheckError::NotGitRepository,
        };
    }
    if let Err(error) = validate_layout(root, &target.layout) {
        return TargetCheck::Unsupported { reason: error };
    }
    TargetCheck::Ready {
        needs_configuration: !root.join(".github/easyblog.yml").is_file(),
    }
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
    use std::{fs, path::Path};

    use super::*;

    fn temporary_directory(name: &str) -> std::path::PathBuf {
        let suffix = uuid::Uuid::new_v4();
        std::env::temp_dir().join(format!("easyblog-target-check-{name}-{suffix}"))
    }

    fn target(root: &Path) -> Target {
        Target::new("target-1", root)
    }

    #[test]
    fn validates_supported_repository_and_reports_missing_config() {
        let root = temporary_directory("ready");
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("_posts")).unwrap();

        assert_eq!(
            check(&target(&root)),
            TargetCheck::Ready {
                needs_configuration: true
            }
        );

        fs::create_dir_all(root.join(".github")).unwrap();
        fs::write(root.join(".github/easyblog.yml"), "adapter: github_pages\n").unwrap();
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
        assert_eq!(
            check(&target(&root)),
            TargetCheck::Unsupported {
                reason: TargetCheckError::MissingPostsDirectory {
                    path: "_posts".into()
                }
            }
        );
        fs::remove_dir_all(root).unwrap();
    }
}
