#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub index_status: char,
    pub worktree_status: char,
    pub path: String,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusParseError {
    InvalidRecord,
}

pub struct GitParser;

impl GitParser {
    pub fn parse_status_porcelain(output: &str) -> Result<Vec<StatusEntry>, StatusParseError> {
        let mut records = output.split('\0').filter(|record| !record.is_empty());
        let mut entries = Vec::new();
        while let Some(record) = records.next() {
            let bytes = record.as_bytes();
            if bytes.len() < 4 || bytes[2] != b' ' {
                return Err(StatusParseError::InvalidRecord);
            }
            let index_status = bytes[0] as char;
            let worktree_status = bytes[1] as char;
            let path = record[3..].to_owned();
            let renamed_or_copied =
                matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C');
            let previous_path = if renamed_or_copied {
                Some(
                    records
                        .next()
                        .ok_or(StatusParseError::InvalidRecord)?
                        .to_owned(),
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
            GitParser::parse_status_porcelain(" M notes.md\0R  new.md\0old.md\0").unwrap(),
            vec![
                StatusEntry {
                    index_status: ' ',
                    worktree_status: 'M',
                    path: "notes.md".into(),
                    previous_path: None
                },
                StatusEntry {
                    index_status: 'R',
                    worktree_status: ' ',
                    path: "new.md".into(),
                    previous_path: Some("old.md".into())
                },
            ]
        );
    }
}
