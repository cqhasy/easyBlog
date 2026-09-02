use crate::content::Article;

/// Stable FNV-1a fingerprint over normalized article data. This deliberately
/// excludes target-specific fields and persists only the resulting hash.
pub fn for_article(article: &Article) -> String {
    let mut input = String::new();
    input.push_str(article.source_identity.as_str());
    input.push('\0');
    input.push_str(article.title.as_deref().unwrap_or_default());
    input.push('\0');
    for (key, value) in &article.metadata {
        input.push_str(key);
        input.push('\0');
        input.push_str(value);
        input.push('\0');
    }
    input.push_str(article.markdown.as_str());
    input.push('\0');
    for resource in &article.resources {
        input.push_str(&format!("{:?}:{}", resource.kind, resource.source_path));
        input.push('\0');
    }
    format!("{:016x}", fnv1a(input.as_bytes()))
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

#[cfg(test)]
mod tests {
    use crate::content::normalize_local_markdown;

    use super::for_article;

    #[test]
    fn fingerprints_normalized_content_deterministically() {
        let left = normalize_local_markdown("post.md", "# Post\r\n").unwrap();
        let right = normalize_local_markdown("post.md", "# Post\n").unwrap();
        assert_eq!(for_article(&left), for_article(&right));
    }
}
