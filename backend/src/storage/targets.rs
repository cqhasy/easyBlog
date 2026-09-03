use std::{path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

use crate::targets::{PagesLayout, PublishingAdapter, Target, TargetState, TargetVisibility};

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
            "INSERT INTO targets (id, workspace_path, name, posts_directory, resources_directory, created_at, repository, default_branch, visibility, target_state, adapter) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![target.target.id, target.target.workspace_path.to_string_lossy(), target.name, target.target.layout.posts_directory.to_string_lossy(), target.target.layout.resources_directory.to_string_lossy(), target.created_at, target.target.repository, target.target.default_branch, visibility_name(&target.target.visibility), state_name(&target.target.state), adapter_name(target.target.adapter.as_ref())],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<ConnectedTarget>> {
        let connection = self
            .connection
            .lock()
            .expect("target repository lock poisoned");
        let mut statement = connection.prepare("SELECT id, workspace_path, name, posts_directory, resources_directory, created_at, repository, default_branch, visibility, target_state, adapter FROM targets ORDER BY created_at, id")?;
        let targets = statement.query_map([], row)?.collect();
        targets
    }

    pub fn get(&self, id: &str) -> Result<Option<ConnectedTarget>> {
        let connection = self
            .connection
            .lock()
            .expect("target repository lock poisoned");
        connection.query_row("SELECT id, workspace_path, name, posts_directory, resources_directory, created_at, repository, default_branch, visibility, target_state, adapter FROM targets WHERE id = ?1", [id], row).optional()
    }

    pub fn find_by_repository(
        &self,
        repository: &str,
        default_branch: &str,
    ) -> Result<Option<ConnectedTarget>> {
        let connection = self
            .connection
            .lock()
            .expect("target repository lock poisoned");
        connection.query_row("SELECT id, workspace_path, name, posts_directory, resources_directory, created_at, repository, default_branch, visibility, target_state, adapter FROM targets WHERE repository = ?1 COLLATE NOCASE AND default_branch = ?2", params![repository, default_branch], row).optional()
    }

    pub fn update(&self, target: &ConnectedTarget) -> Result<()> {
        self.connection
            .lock()
            .expect("target repository lock poisoned")
            .execute(
                "UPDATE targets SET posts_directory = ?2, resources_directory = ?3, target_state = ?4, adapter = ?5 WHERE id = ?1",
                params![target.target.id, target.target.layout.posts_directory.to_string_lossy(), target.target.layout.resources_directory.to_string_lossy(), state_name(&target.target.state), adapter_name(target.target.adapter.as_ref())],
            )?;
        Ok(())
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
            repository: row.get(6)?,
            default_branch: row.get(7)?,
            visibility: if row.get::<_, String>(8)? == "public" {
                TargetVisibility::Public
            } else {
                TargetVisibility::Private
            },
            state: match row.get::<_, String>(9)?.as_str() {
                "ready" => TargetState::Ready,
                "needs_configuration" | "needs_initialization" => TargetState::NeedsConfiguration,
                "needs_recovery" => TargetState::NeedsRecovery,
                _ => TargetState::NeedsReconnect,
            },
            adapter: match row.get::<_, Option<String>>(10)?.as_deref() {
                Some("github_pages") => Some(PublishingAdapter::GithubPages),
                Some("astro_content") => Some(PublishingAdapter::AstroContent),
                _ => None,
            },
        },
        name: row.get(2)?,
        created_at: row.get(5)?,
    })
}
fn adapter_name(value: Option<&PublishingAdapter>) -> Option<&'static str> {
    match value {
        Some(PublishingAdapter::GithubPages) => Some("github_pages"),
        Some(PublishingAdapter::AstroContent) => Some("astro_content"),
        None => None,
    }
}

fn visibility_name(value: &TargetVisibility) -> &'static str {
    match value {
        TargetVisibility::Public => "public",
        TargetVisibility::Private => "private",
    }
}
fn state_name(value: &TargetState) -> &'static str {
    match value {
        TargetState::Ready => "ready",
        TargetState::NeedsConfiguration => "needs_configuration",
        TargetState::NeedsRecovery => "needs_recovery",
        TargetState::NeedsReconnect => "needs_reconnect",
    }
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

    #[test]
    fn finds_repository_case_insensitively_while_preserving_branch_case() {
        let repo = TargetRepository::open(":memory:").unwrap();
        let mut target = Target::new("target-1", "C:/blog");
        target.repository = "owner/blog".into();
        target.default_branch = "Main".into();
        let connected = ConnectedTarget {
            target,
            name: "owner/blog".into(),
            created_at: "2026-09-02T00:00:00Z".into(),
        };
        repo.insert(&connected).unwrap();

        assert_eq!(
            repo.find_by_repository("Owner/Blog", "Main").unwrap(),
            Some(connected)
        );
        assert_eq!(repo.find_by_repository("owner/blog", "main").unwrap(), None);
    }
}
