use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

use crate::targets::{PagesLayout, Target};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectedTarget {
    #[serde(flatten)]
    pub target: Target,
    pub name: String,
    pub created_at: String,
}

pub struct TargetRepository {
    connection: Mutex<Connection>,
}

impl TargetRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn insert(&self, target: &ConnectedTarget) -> Result<()> {
        self.connection.lock().expect("target repository lock poisoned").execute(
            "INSERT INTO targets (id, workspace_path, name, posts_directory, resources_directory, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![target.target.id, target.target.workspace_path.to_string_lossy(), target.name, target.target.layout.posts_directory.to_string_lossy(), target.target.layout.resources_directory.to_string_lossy(), target.created_at],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ConnectedTarget>> {
        let connection = self
            .connection
            .lock()
            .expect("target repository lock poisoned");
        let mut statement = connection.prepare("SELECT id, workspace_path, name, posts_directory, resources_directory, created_at FROM targets ORDER BY created_at, id")?;
        let targets = statement.query_map([], row)?.collect();
        targets
    }

    pub fn get(&self, id: &str) -> Result<Option<ConnectedTarget>> {
        let connection = self
            .connection
            .lock()
            .expect("target repository lock poisoned");
        connection.query_row("SELECT id, workspace_path, name, posts_directory, resources_directory, created_at FROM targets WHERE id = ?1", [id], row).optional()
    }
}

fn row(row: &rusqlite::Row<'_>) -> Result<ConnectedTarget> {
    Ok(ConnectedTarget {
        target: Target {
            id: row.get(0)?,
            workspace_path: row.get::<_, String>(1)?.into(),
            layout: PagesLayout {
                posts_directory: row.get::<_, String>(3)?.into(),
                resources_directory: row.get::<_, String>(4)?.into(),
            },
        },
        name: row.get(2)?,
        created_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_target_metadata_without_secrets() {
        let repo = TargetRepository::open(":memory:").unwrap();
        let target = ConnectedTarget {
            target: Target::new("target-1", "C:/blog"),
            name: "Blog".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        repo.insert(&target).unwrap();
        assert_eq!(repo.list().unwrap(), vec![target]);
    }
}
