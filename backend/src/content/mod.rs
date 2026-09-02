pub mod article;
pub mod conversion_warning;
pub mod frontmatter;
pub mod markdown;
pub mod resource;
pub mod slug;

pub use article::Article;
pub use conversion_warning::ConversionWarning;
pub use frontmatter::{Frontmatter, FrontmatterError};
pub use markdown::Markdown;
pub use resource::{references as resource_references, ResourceKind, ResourceReference};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NormalizeError {
    InvalidSourceIdentity,
    InvalidFrontmatter(FrontmatterError),
}

pub fn normalize_local_markdown(
    source_identity: impl Into<String>,
    input: &str,
) -> Result<Article, NormalizeError> {
    let source_identity = source_identity.into();
    if source_identity.trim().is_empty() {
        return Err(NormalizeError::InvalidSourceIdentity);
    }
    let normalized = Markdown::normalize(input);
    let frontmatter =
        Frontmatter::parse(normalized.as_str()).map_err(NormalizeError::InvalidFrontmatter)?;
    let title = frontmatter
        .fields
        .get("title")
        .cloned()
        .filter(|value| !value.is_empty())
        .or_else(|| first_heading(&frontmatter.body));
    let resources = resource_references(&frontmatter.body);
    Ok(Article {
        source_identity,
        title,
        metadata: frontmatter.fields,
        markdown: Markdown(frontmatter.body),
        resources,
        warnings: Vec::new(),
    })
}

fn first_heading(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let title = line.strip_prefix('#')?.trim_start_matches('#').trim();
        (!title.is_empty()).then(|| title.to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_article_without_assigning_target_fields() {
        let article = normalize_local_markdown(
            "notes/welcome.md",
            "---\ntitle: Custom title\ncategory: notes\n---\n# Ignored heading\r\n![logo](media/logo.png)\r\n",
        )
        .unwrap();
        assert_eq!(article.source_identity, "notes/welcome.md");
        assert_eq!(article.title.as_deref(), Some("Custom title"));
        assert_eq!(
            article.markdown.as_str(),
            "# Ignored heading\n![logo](media/logo.png)\n"
        );
        assert_eq!(
            article.metadata.get("category").map(String::as_str),
            Some("notes")
        );
        assert_eq!(article.resources.len(), 1);
        assert!(article.warnings.is_empty());
    }

    #[test]
    fn derives_display_title_from_first_atx_heading() {
        let article = normalize_local_markdown("post.md", "intro\n## A heading\n").unwrap();
        assert_eq!(article.title.as_deref(), Some("A heading"));
    }

    #[test]
    fn blocks_ambiguous_frontmatter() {
        assert_eq!(
            normalize_local_markdown("post.md", "---\ntitle: one\ntitle: two\n---\n"),
            Err(NormalizeError::InvalidFrontmatter(
                FrontmatterError::DuplicateKey {
                    key: "title".into()
                }
            ))
        );
    }
}
