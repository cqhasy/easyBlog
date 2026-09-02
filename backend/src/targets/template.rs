use std::{collections::BTreeMap, path::PathBuf};

use crate::content::{Article, ResourceReference};

use super::layout::{LayoutError, PagesLayout};

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
    layout: PagesLayout,
}

impl Template {
    pub fn new(layout: PagesLayout) -> Self {
        Self { layout }
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

        Ok(RenderedArticle {
            path: self.layout.article_path(&slug),
            slug,
            markdown: render_markdown(&metadata, article.markdown.as_str()),
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

    pub fn configuration(&self) -> String {
        "adapter: github_pages\nposts_directory: _posts\nresources_directory: assets/easyblog\n"
            .into()
    }
}

impl Default for Template {
    fn default() -> Self {
        Self::new(PagesLayout::default())
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

fn render_markdown(metadata: &BTreeMap<String, String>, body: &str) -> String {
    let mut output = String::from("---\n");
    for (key, value) in metadata {
        output.push_str(key);
        output.push_str(": \"");
        output.push_str(&escape_yaml(value));
        output.push_str("\"\n");
    }
    output.push_str("---\n");
    output.push_str(body);
    output
}

fn escape_yaml(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
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
            "adapter: github_pages\nposts_directory: _posts\nresources_directory: assets/easyblog\n"
        );
    }
}
