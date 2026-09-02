use crate::sources::source::Source;
use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::sync::Mutex;

pub struct SourceRepository {
    connection: Mutex<Connection>,
}

impl SourceRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn insert(&self, source: &Source) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .expect("source repository lock poisoned");
        connection.execute(
            "INSERT INTO sources (id, path, name, source_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source.id,
                source.path,
                source.name,
                source.source_type,
                source.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Source>> {
        let connection = self
            .connection
            .lock()
            .expect("source repository lock poisoned");
        let mut statement = connection.prepare(
            "SELECT id, path, name, source_type, created_at
             FROM sources ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Source {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                source_type: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db() -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("easyblog-sources-{suffix}.db"))
    }

    #[test]
    fn inserts_and_lists_source_metadata() {
        let path = temp_db();
        let repo = SourceRepository::open(&path).unwrap();
        let source = Source {
            id: "source-1".into(),
            path: "C:/content".into(),
            name: "Content".into(),
            source_type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };

        repo.insert(&source).unwrap();
        assert_eq!(repo.list().unwrap(), vec![source]);
        drop(repo);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_duplicate_paths_and_persists_after_reopen() {
        let path = temp_db();
        let source = Source {
            id: "source-1".into(),
            path: "C:/content".into(),
            name: "Content".into(),
            source_type: "local_directory".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        {
            let repo = SourceRepository::open(&path).unwrap();
            repo.insert(&source).unwrap();
            let duplicate = Source {
                id: "source-2".into(),
                ..source.clone()
            };
            assert!(repo.insert(&duplicate).is_err());
        }
        let repo = SourceRepository::open(&path).unwrap();
        assert_eq!(repo.list().unwrap(), vec![source]);
        drop(repo);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn initializes_schema_on_connection() {
        let connection = Connection::open_in_memory().unwrap();
        crate::storage::database::initialize(&connection).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
