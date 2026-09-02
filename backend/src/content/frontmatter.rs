use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frontmatter {
    pub fields: BTreeMap<String, String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrontmatterError {
    Unterminated,
    InvalidLine { line: usize },
    EmptyKey { line: usize },
    DuplicateKey { key: String },
}

impl Frontmatter {
    pub fn parse(input: &str) -> Result<Self, FrontmatterError> {
        if !input.starts_with("---\n") {
            return Ok(Self {
                fields: BTreeMap::new(),
                body: input.to_owned(),
            });
        }

        let after_opening_delimiter = &input[4..];
        let (metadata, body) = if let Some(body) = after_opening_delimiter.strip_prefix("---\n") {
            ("", body.to_owned())
        } else {
            let Some(end) = after_opening_delimiter.find("\n---\n") else {
                return Err(FrontmatterError::Unterminated);
            };
            (
                &after_opening_delimiter[..end],
                after_opening_delimiter[end + 5..].to_owned(),
            )
        };
        let mut fields = BTreeMap::new();
        for (index, line) in metadata.lines().enumerate() {
            if line.trim().is_empty() || line.trim_start().starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once(':') else {
                return Err(FrontmatterError::InvalidLine { line: index + 2 });
            };
            let key = key.trim();
            if key.is_empty() {
                return Err(FrontmatterError::EmptyKey { line: index + 2 });
            }
            let value = value.trim().trim_matches(['\'', '"']).to_owned();
            if fields.insert(key.to_owned(), value).is_some() {
                return Err(FrontmatterError::DuplicateKey {
                    key: key.to_owned(),
                });
            }
        }
        Ok(Self { fields, body })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separates_and_sorts_simple_frontmatter() {
        let parsed = Frontmatter::parse("---\nz: final\ntitle: Hello\n---\n# Heading\n").unwrap();
        assert_eq!(parsed.fields.keys().collect::<Vec<_>>(), vec!["title", "z"]);
        assert_eq!(parsed.body, "# Heading\n");
    }

    #[test]
    fn rejects_unterminated_or_ambiguous_frontmatter() {
        assert_eq!(
            Frontmatter::parse("---\ntitle: Hello\n"),
            Err(FrontmatterError::Unterminated)
        );
        assert_eq!(
            Frontmatter::parse("---\ntitle: one\ntitle: two\n---\n"),
            Err(FrontmatterError::DuplicateKey {
                key: "title".into()
            })
        );
    }

    #[test]
    fn accepts_empty_frontmatter_with_a_markdown_body() {
        let parsed = Frontmatter::parse("---\n---\n# Heading\n").unwrap();
        assert!(parsed.fields.is_empty());
        assert_eq!(parsed.body, "# Heading\n");
    }
}
