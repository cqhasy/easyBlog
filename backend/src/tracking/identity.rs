use std::path::Path;

pub fn local_source_identity(path: &Path) -> String {
    #[cfg(windows)]
    {
        path.to_string_lossy().replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(not(windows))]
    fn preserves_backslashes_that_are_part_of_unix_file_names() {
        assert_eq!(
            local_source_identity(Path::new(r"draft\2026.md")),
            r"draft\2026.md"
        );
    }

    #[test]
    #[cfg(windows)]
    fn normalizes_windows_path_separators() {
        assert_eq!(
            local_source_identity(Path::new(r"draft\2026.md")),
            "draft/2026.md"
        );
    }
}
