#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub index_status: char,
    pub worktree_status: char,
    pub path: Vec<u8>,
    pub previous_path: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusParseError {
    InvalidRecord,
}

pub struct GitParser;

impl GitParser {
    pub fn parse_status_porcelain(output: &[u8]) -> Result<Vec<StatusEntry>, StatusParseError> {
        let mut records = output
            .split(|byte| *byte == b'\0')
            .filter(|record| !record.is_empty());
        let mut entries = Vec::new();
        while let Some(record) = records.next() {
            if record.len() < 4 || record[2] != b' ' {
                return Err(StatusParseError::InvalidRecord);
            }
            let index_status = record[0] as char;
            let worktree_status = record[1] as char;
            let path = record[3..].to_vec();
            let renamed_or_copied =
                matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C');
            let previous_path = if renamed_or_copied {
                Some(
                    records
                        .next()
                        .ok_or(StatusParseError::InvalidRecord)?
                        .to_vec(),
                )
            } else {
                None
            };
            entries.push(StatusEntry {
                index_status,
                worktree_status,
                path,
                previous_path,
            });
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_regular_and_renamed_status_entries() {
        assert_eq!(
            GitParser::parse_status_porcelain(b" M notes.md\0R  new.md\0old.md\0").unwrap(),
            vec![
                StatusEntry {
                    index_status: ' ',
                    worktree_status: 'M',
                    path: b"notes.md".to_vec(),
                    previous_path: None
                },
                StatusEntry {
                    index_status: 'R',
                    worktree_status: ' ',
                    path: b"new.md".to_vec(),
                    previous_path: Some(b"old.md".to_vec())
                },
            ]
        );
    }

    #[test]
    fn preserves_non_utf8_pathname_bytes() {
        let entries = GitParser::parse_status_porcelain(b" M notes-\xff.md\0").unwrap();
        assert_eq!(entries[0].path, b"notes-\xff.md");
    }
}
