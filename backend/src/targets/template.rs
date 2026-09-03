use std::{collections::BTreeMap, path::PathBuf};

use chrono::Utc;

use crate::content::{Article, ResourceReference};

use super::{
    layout::{LayoutError, PagesLayout},
    PublishingAdapter,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedArticle {
    pub slug: String,
    pub path: PathBuf,
    pub markdown: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedResource {
    pub source_path: String,
    pub target_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateError {
    MissingTitle,
    InvalidSlug,
    InvalidResource(LayoutError),
}

pub struct Template {
    adapter: PublishingAdapter,
    layout: PagesLayout,
}

impl Template {
    pub fn new(adapter: PublishingAdapter, layout: PagesLayout) -> Self {
        Self { adapter, layout }
    }

    pub fn render_article(&self, article: &Article) -> Result<RenderedArticle, TemplateError> {
        let title = article
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .ok_or(TemplateError::MissingTitle)?;
        let slug = slug(title).ok_or(TemplateError::InvalidSlug)?;
        let mut metadata = article.metadata.clone();
        metadata.insert("title".into(), title.into());
        metadata.insert("slug".into(), slug.clone());
        if self.adapter == PublishingAdapter::AstroContent {
            metadata
                .entry("published".into())
                .or_insert_with(|| Utc::now().date_naive().to_string());
        }

        Ok(RenderedArticle {
            path: self.layout.article_path(&slug),
            slug,
            markdown: render_markdown(&self.adapter, &metadata, article.markdown.as_str()),
        })
    }

    pub fn render_resources(
        &self,
        slug: &str,
        resources: &[ResourceReference],
    ) -> Result<Vec<RenderedResource>, TemplateError> {
        resources
            .iter()
            .map(|resource| {
                self.layout
                    .resource_path(slug, &resource.source_path)
                    .map(|target_path| RenderedResource {
                        source_path: resource.source_path.clone(),
                        target_path,
                    })
                    .map_err(TemplateError::InvalidResource)
            })
            .collect()
    }

    pub fn configuration(&self) -> Option<String> {
        self.adapter.configuration_path().map(|_| {
            format!(
                "adapter: github_pages\nposts_directory: \"{}\"\nresources_directory: \"{}\"\n",
                escape_yaml(&self.layout.posts_directory.to_string_lossy()),
                escape_yaml(&self.layout.resources_directory.to_string_lossy())
            )
        })
    }
}

impl Default for Template {
    fn default() -> Self {
        Self::new(PublishingAdapter::GithubPages, PagesLayout::default())
    }
}

pub fn slug(input: &str) -> Option<String> {
    let mut output = String::new();
    let mut pending_separator = false;
    for character in input.trim().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !output.is_empty() {
                output.push('-');
            }
            output.extend(character.to_lowercase());
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }
    (!output.is_empty()).then_some(output)
}

fn render_markdown(
    adapter: &PublishingAdapter,
    metadata: &BTreeMap<String, String>,
    body: &str,
) -> String {
    let mut output = String::from("---\n");
    for (key, value) in metadata {
        output.push_str(key);
        output.push_str(": ");
        if adapter == &PublishingAdapter::AstroContent
            && matches!(key.as_str(), "published" | "updated")
            && is_iso_date(value)
        {
            output.push_str(value);
        } else {
            output.push('"');
            output.push_str(&escape_yaml(value));
            output.push('"');
        }
        output.push('\n');
    }
    output.push_str("---\n");
    output.push_str(body);
    output
}

fn escape_yaml(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn is_iso_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

#[cfg(test)]
mod tests {
    use crate::content::normalize_local_markdown;

    use super::*;

    #[test]
    fn renders_deterministic_jekyll_post_and_resource_paths() {
        let article = normalize_local_markdown(
            "posts/hello.md",
            "---\ncategory: notes\ntitle: Hello, World!\n---\nBody\n![cover](media/cover.png)\n",
        )
        .unwrap();
        let template = Template::default();

        let rendered = template.render_article(&article).unwrap();
        assert_eq!(rendered.slug, "hello-world");
        assert_eq!(rendered.path, PathBuf::from("_posts/hello-world.md"));
        assert_eq!(
            rendered.markdown,
            "---\ncategory: \"notes\"\nslug: \"hello-world\"\ntitle: \"Hello, World!\"\n---\nBody\n![cover](media/cover.png)\n"
        );
        assert_eq!(
            template
                .render_resources(&rendered.slug, &article.resources)
                .unwrap(),
            vec![RenderedResource {
                source_path: "media/cover.png".into(),
                target_path: PathBuf::from("assets/easyblog/hello-world/cover.png"),
            }]
        );
    }

    #[test]
    fn preserves_unicode_titles_in_slugs_and_rejects_empty_ones() {
        assert_eq!(slug("  你好，世界  "), Some("你好-世界".into()));
        assert_eq!(slug("---"), None);
    }

    #[test]
    fn generates_non_sensitive_configuration() {
        assert_eq!(
            Template::default().configuration(),
            Some("adapter: github_pages\nposts_directory: \"_posts\"\nresources_directory: \"assets/easyblog\"\n".into())
        );
    }

    #[test]
    fn serializes_configuration_directories_as_yaml_scalars() {
        let template = Template::new(
            PublishingAdapter::GithubPages,
            PagesLayout {
                posts_directory: "posts # archive".into(),
                resources_directory: "assets: public\nimages".into(),
            },
        );

        assert_eq!(
            template.configuration(),
            Some(
                "adapter: github_pages\nposts_directory: \"posts # archive\"\nresources_directory: \"assets: public\\nimages\"\n".into()
            )
        );
    }

    #[test]
    fn adds_the_required_astro_published_date_without_changing_existing_dates() {
        let article = normalize_local_markdown("cobra.md", "# Cobra\n").unwrap();
        let template = Template::new(
            PublishingAdapter::AstroContent,
            PublishingAdapter::AstroContent.default_layout(),
        );
        let rendered = template.render_article(&article).unwrap();
        let published = Utc::now().date_naive();

        assert_eq!(rendered.path, PathBuf::from("src/content/posts/cobra.md"));
        assert!(rendered
            .markdown
            .contains(&format!("published: {published}\n")));

        let dated = normalize_local_markdown(
            "dated.md",
            "---\npublished: 2026-09-02\nupdated: 2026-09-03\n---\n# Dated\n",
        )
        .unwrap();
        let rendered = template.render_article(&dated).unwrap();
        assert!(rendered.markdown.contains("published: 2026-09-02\n"));
        assert!(rendered.markdown.contains("updated: 2026-09-03\n"));
        assert!(!rendered.markdown.contains("published: \"2026-09-02\""));
    }
}
