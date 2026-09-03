use std::{fs, path::PathBuf};

use serde::Serialize;

use crate::{
    shared::errors::{AppError, AppResult},
    storage::targets::{ConnectedTarget, TargetRepository},
    targets::{PagesLayout, PublishingAdapter, TargetCheck, TargetState},
    workspace::WorkingTree,
};

pub struct ConfigureTargetInput {
    pub target_id: String,
    pub adapter: PublishingAdapter,
    pub posts_directory: String,
    pub resources_directory: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayoutCandidate {
    pub adapter: PublishingAdapter,
    pub posts_directory: String,
    pub resources_directory: String,
    pub reason: String,
    pub requires_initialization: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InitializationPreview {
    pub target_id: String,
    pub files: Vec<String>,
}

pub fn inspect(targets: &TargetRepository, target_id: &str) -> AppResult<Vec<LayoutCandidate>> {
    let target = load(targets, target_id)?;
    validate_workspace(&target)?;
    let root = target.target.path();
    let astro = root.join("astro.config.mjs").is_file()
        || root.join("astro.config.ts").is_file()
        || root.join("src/content").is_dir();
    let astro_layout = PublishingAdapter::AstroContent.default_layout();
    let pages_layout = PublishingAdapter::GithubPages.default_layout();
    Ok(vec![
        LayoutCandidate {
            adapter: PublishingAdapter::AstroContent,
            posts_directory: astro_layout.posts_directory.display().to_string(),
            resources_directory: astro_layout.resources_directory.display().to_string(),
            reason: if astro {
                "Detected Astro configuration or content collection directory".into()
            } else {
                "Use when this repository publishes Astro content collections".into()
            },
            requires_initialization: !root.join(&astro_layout.posts_directory).is_dir(),
        },
        LayoutCandidate {
            adapter: PublishingAdapter::GithubPages,
            posts_directory: pages_layout.posts_directory.display().to_string(),
            resources_directory: pages_layout.resources_directory.display().to_string(),
            reason: "Use when this repository is configured for Jekyll-style GitHub Pages posts"
                .into(),
            requires_initialization: !root.join(&pages_layout.posts_directory).is_dir(),
        },
    ])
}

pub fn save(targets: &TargetRepository, input: ConfigureTargetInput) -> AppResult<ConnectedTarget> {
    let mut target = load(targets, &input.target_id)?;
    validate_workspace(&target)?;
    let layout = PagesLayout {
        posts_directory: PathBuf::from(input.posts_directory.trim()),
        resources_directory: PathBuf::from(input.resources_directory.trim()),
    };
    validate_paths(&layout)?;
    target.target.adapter = Some(input.adapter);
    target.target.layout = layout;
    target.target.state = if layout_is_initialized(&target.target) {
        TargetState::Ready
    } else {
        TargetState::NeedsConfiguration
    };
    targets
        .update(&target)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be saved"))?;
    Ok(target)
}

fn layout_is_initialized(target: &crate::targets::Target) -> bool {
    target.path().join(&target.layout.posts_directory).is_dir()
        && target
            .path()
            .join(&target.layout.resources_directory)
            .is_dir()
        && target
            .adapter
            .as_ref()
            .and_then(PublishingAdapter::configuration_path)
            .is_none_or(|path| target.path().join(path).is_file())
}

pub fn preview_initialization(
    targets: &TargetRepository,
    target_id: &str,
) -> AppResult<InitializationPreview> {
    let target = load(targets, target_id)?;
    validate_workspace(&target)?;
    let adapter = target.target.adapter.as_ref().ok_or_else(|| {
        AppError::new(
            "target_needs_configuration",
            "Choose a publishing adapter before initialization",
        )
    })?;
    validate_paths(&target.target.layout)?;
    let files = missing_initialization_files(&target.target, adapter);
    Ok(InitializationPreview {
        target_id: target_id.into(),
        files,
    })
}

pub fn initialize(targets: &TargetRepository, target_id: &str) -> AppResult<ConnectedTarget> {
    let mut target = load(targets, target_id)?;
    validate_workspace(&target)?;
    let adapter = target.target.adapter.clone().ok_or_else(|| {
        AppError::new(
            "target_needs_configuration",
            "Choose a publishing adapter before initialization",
        )
    })?;
    validate_paths(&target.target.layout)?;
    WorkingTree::require_clean(target.target.path())
        .map_err(|_| AppError::new("workspace_dirty", "The target workspace has external edits"))?;
    let posts_directory = target
        .target
        .path()
        .join(&target.target.layout.posts_directory);
    if !posts_directory.is_dir() {
        fs::create_dir_all(posts_directory).map_err(|_| {
            AppError::new(
                "initialization_failed",
                "Publishing directory could not be created",
            )
        })?;
    }
    let resources_directory = target
        .target
        .path()
        .join(&target.target.layout.resources_directory);
    if !resources_directory.is_dir() {
        fs::create_dir_all(resources_directory).map_err(|_| {
            AppError::new(
                "initialization_failed",
                "Resource directory could not be created",
            )
        })?;
    }
    if let Some(path) = adapter.configuration_path() {
        let output = target.target.path().join(path);
        if !output.is_file() {
            let configuration =
                crate::targets::Template::new(adapter, target.target.layout.clone())
                    .configuration()
                    .expect("adapter owns configuration path");
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|_| {
                    AppError::new(
                        "initialization_failed",
                        "Configuration directory could not be created",
                    )
                })?;
            }
            fs::write(output, configuration).map_err(|_| {
                AppError::new(
                    "initialization_failed",
                    "Publishing configuration could not be written",
                )
            })?;
        }
    }
    target.target.state = TargetState::Ready;
    targets
        .update(&target)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be saved"))?;
    Ok(target)
}

fn missing_initialization_files(
    target: &crate::targets::Target,
    adapter: &PublishingAdapter,
) -> Vec<String> {
    let mut files = Vec::new();
    for directory in [
        &target.layout.posts_directory,
        &target.layout.resources_directory,
    ] {
        if !target.path().join(directory).is_dir() {
            files.push(directory.display().to_string());
        }
    }
    if let Some(path) = adapter.configuration_path() {
        if !target.path().join(path).is_file() {
            files.push(path.into());
        }
    }
    files
}

fn load(targets: &TargetRepository, target_id: &str) -> AppResult<ConnectedTarget> {
    targets
        .get(target_id)
        .map_err(|_| AppError::new("storage_error", "Publishing target could not be loaded"))?
        .ok_or_else(|| AppError::new("target_not_found", "Publishing target no longer exists"))
}

fn validate_workspace(target: &ConnectedTarget) -> AppResult<()> {
    match crate::targets::check(&target.target) {
        TargetCheck::Unsupported { .. } => Err(AppError::new(
            "target_unavailable",
            "The publishing target workspace is unavailable",
        )),
        _ => Ok(()),
    }
}

fn validate_paths(layout: &PagesLayout) -> AppResult<()> {
    for path in [&layout.posts_directory, &layout.resources_directory] {
        if path.as_os_str().is_empty() || !PagesLayout::is_safe_relative_path(path) {
            return Err(AppError::new(
                "invalid_layout_path",
                "Publishing directories must be non-empty relative paths",
            ));
        }
    }
    if layout.posts_directory == layout.resources_directory {
        return Err(AppError::new(
            "invalid_layout_path",
            "Article and resource directories must be different",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use chrono::{SecondsFormat, Utc};

    use super::*;
    use crate::{
        storage::targets::ConnectedTarget,
        targets::{Target, TargetVisibility},
    };

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn connected(root: &Path) -> ConnectedTarget {
        ConnectedTarget {
            target: Target {
                id: "target-1".into(),
                workspace_path: root.into(),
                repository: "owner/blog".into(),
                default_branch: "main".into(),
                visibility: TargetVisibility::Public,
                state: TargetState::NeedsConfiguration,
                adapter: None,
                layout: PagesLayout::default(),
            },
            name: "owner/blog".into(),
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        }
    }

    #[test]
    fn saves_astro_layout_without_writing_then_initializes_after_confirmation() {
        let root = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        fs::write(root.join("astro.config.mjs"), "export default {}\n").unwrap();
        git(&root, &["add", "astro.config.mjs"]);
        git(
            &root,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial Astro configuration",
            ],
        );
        let database = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let targets = TargetRepository::open(&database).unwrap();
        targets.insert(&connected(&root)).unwrap();

        let candidates = inspect(&targets, "target-1").unwrap();
        assert_eq!(candidates[0].adapter, PublishingAdapter::AstroContent);
        assert!(candidates[0].requires_initialization);

        let saved = save(
            &targets,
            ConfigureTargetInput {
                target_id: "target-1".into(),
                adapter: PublishingAdapter::AstroContent,
                posts_directory: "src/content/posts".into(),
                resources_directory: "src/assets/easyblog".into(),
            },
        )
        .unwrap();
        assert_eq!(saved.target.state, TargetState::NeedsConfiguration);
        assert!(!root.join("src/content/posts").exists());
        assert!(!root.join("src/assets/easyblog").exists());

        let preview = preview_initialization(&targets, "target-1").unwrap();
        assert_eq!(
            preview.files,
            vec!["src/content/posts", "src/assets/easyblog"]
        );
        assert!(!root.join("src/content/posts").exists());

        let initialized = initialize(&targets, "target-1").unwrap();
        assert_eq!(initialized.target.state, TargetState::Ready);
        assert!(root.join("src/content/posts").is_dir());
        assert!(root.join("src/assets/easyblog").is_dir());
        assert!(!root.join(".github/easyblog.yml").exists());

        drop(targets);
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(database).unwrap();
    }

    #[test]
    fn rejects_unsafe_layout_paths_without_writing() {
        let root = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        let database = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let targets = TargetRepository::open(&database).unwrap();
        targets.insert(&connected(&root)).unwrap();

        let error = save(
            &targets,
            ConfigureTargetInput {
                target_id: "target-1".into(),
                adapter: PublishingAdapter::GithubPages,
                posts_directory: "../outside".into(),
                resources_directory: "assets/easyblog".into(),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_layout_path");
        assert!(!root.parent().unwrap().join("outside").exists());

        drop(targets);
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(database).unwrap();
    }

    #[test]
    fn initializes_github_pages_only_after_previewing_missing_files() {
        let root = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        let database = std::env::temp_dir().join(format!(
            "easyblog-configure-target-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let targets = TargetRepository::open(&database).unwrap();
        targets.insert(&connected(&root)).unwrap();

        let saved = save(
            &targets,
            ConfigureTargetInput {
                target_id: "target-1".into(),
                adapter: PublishingAdapter::GithubPages,
                posts_directory: "_posts".into(),
                resources_directory: "assets/easyblog".into(),
            },
        )
        .unwrap();
        assert_eq!(saved.target.state, TargetState::NeedsConfiguration);
        assert!(!root.join("_posts").exists());
        assert!(!root.join("assets/easyblog").exists());
        assert!(!root.join(".github/easyblog.yml").exists());

        assert_eq!(
            preview_initialization(&targets, "target-1").unwrap().files,
            vec!["_posts", "assets/easyblog", ".github/easyblog.yml"]
        );

        let initialized = initialize(&targets, "target-1").unwrap();
        assert_eq!(initialized.target.state, TargetState::Ready);
        assert!(root.join("_posts").is_dir());
        assert!(root.join("assets/easyblog").is_dir());
        assert!(root.join(".github/easyblog.yml").is_file());
        assert_eq!(
            preview_initialization(&targets, "target-1").unwrap().files,
            Vec::<String>::new()
        );

        drop(targets);
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(database).unwrap();
    }
}
