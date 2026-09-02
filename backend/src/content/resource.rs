#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceKind {
    Image,
    Attachment,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceReference {
    pub kind: ResourceKind,
    pub source_path: String,
}

pub fn references(markdown: &str) -> Vec<ResourceReference> {
    let mut resources = Vec::new();
    let mut in_code_fence = false;
    for line in markdown.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if in_code_fence {
            continue;
        }
        let mut offset = 0;
        while let Some(open) = line[offset..].find("](") {
            let open = offset + open;
            let path_start = open + 2;
            let Some(close) = line[path_start..].find(')') else {
                break;
            };
            let path = &line[path_start..path_start + close];
            let is_image = line[..open]
                .rfind('[')
                .is_some_and(|label_start| line[..label_start].ends_with('!'));
            let kind = if is_image {
                ResourceKind::Image
            } else if is_attachment_path(path) {
                ResourceKind::Attachment
            } else {
                offset = path_start + close + 1;
                continue;
            };
            add_reference(&mut resources, kind, path);
            offset = path_start + close + 1;
        }
    }
    resources.sort_by(|left, right| left.source_path.cmp(&right.source_path));
    resources.dedup_by(|left, right| left.source_path == right.source_path);
    resources
}

fn is_attachment_path(path: &str) -> bool {
    let path = path.trim().to_ascii_lowercase();
    [
        ".zip", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".mp3",
        ".mp4", ".mov", ".wav",
    ]
    .iter()
    .any(|extension| path.ends_with(extension))
}

fn add_reference(resources: &mut Vec<ResourceReference>, kind: ResourceKind, path: &str) {
    let path = path.trim();
    if path.is_empty()
        || path.starts_with('#')
        || path.contains("://")
        || path.starts_with("mailto:")
        || path.starts_with('/')
    {
        return;
    }
    resources.push(ResourceReference {
        kind,
        source_path: path.to_owned(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_local_images_and_attachments_but_not_links_or_code() {
        assert_eq!(
            references("![diagram](assets/diagram.png) [download](files/data.zip) [site](https://example.com)\n```md\n![skip](nope.png)\n```\n"),
            vec![
                ResourceReference { kind: ResourceKind::Image, source_path: "assets/diagram.png".into() },
                ResourceReference { kind: ResourceKind::Attachment, source_path: "files/data.zip".into() },
            ]
        );
    }
}
