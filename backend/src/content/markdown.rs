#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Markdown(String);

impl Markdown {
    pub fn normalize(input: &str) -> Self {
        let content = input.strip_prefix('\u{feff}').unwrap_or(input);
        let content = content.replace("\r\n", "\n").replace('\r', "\n");
        Self(content.trim_end_matches('\n').to_owned() + "\n")
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::Markdown;

    #[test]
    fn normalizes_bom_line_endings_and_terminal_newline() {
        assert_eq!(
            Markdown::normalize("\u{feff}# title\r\ntext\r\n\r\n"),
            Markdown::normalize("# title\ntext\n")
        );
    }
}
