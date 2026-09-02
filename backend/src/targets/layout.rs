use std::path::{Component, Path, PathBuf};

/// The single GitHub Pages layout supported in v1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PagesLayout {
    pub posts_directory: PathBuf,
    pub resources_directory: PathBuf,
}

impl Default for PagesLayout {
    fn default() -> Self {
        Self {
            posts_directory: PathBuf::from("_posts"),
            resources_directory: PathBuf::from("assets/easyblog"),
        }
    }
}

impl PagesLayout {
    pub fn article_path(&self, slug: &str) -> PathBuf {
        self.posts_directory.join(format!("{slug}.md"))
    }

    pub fn resource_path(&self, slug: &str, source_path: &str) -> Result<PathBuf, LayoutError> {
        let filename = Path::new(source_path)
            .file_name()
            .filter(|name| !name.is_empty())
            .ok_or(LayoutError::MissingResourceFilename)?;
        Ok(self.resources_directory.join(slug).join(filename))
    }

    pub fn is_safe_relative_path(path: &Path) -> bool {
        !path.is_absolute()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    MissingResourceFilename,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_stable_article_and_resource_paths() {
        let layout = PagesLayout::default();
        assert_eq!(
            layout.article_path("hello-world"),
            PathBuf::from("_posts/hello-world.md")
        );
        assert_eq!(
            layout
                .resource_path("hello-world", "images/cover.png")
                .unwrap(),
            PathBuf::from("assets/easyblog/hello-world/cover.png")
        );
    }

    #[test]
    fn recognizes_only_safe_relative_paths() {
        assert!(PagesLayout::is_safe_relative_path(Path::new(
            "_posts/hello.md"
        )));
        assert!(!PagesLayout::is_safe_relative_path(Path::new(
            "../outside.md"
        )));
        assert!(!PagesLayout::is_safe_relative_path(Path::new(
            "/outside.md"
        )));
    }
}
