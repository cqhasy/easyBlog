use crate::scopes::scope::{Scope, ScopeLifecycle, ScopeSelection, SourceNodeRef};
use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::sync::Mutex;

pub struct ScopeRepository {
    connection: Mutex<Connection>,
}

impl ScopeRepository {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        crate::storage::database::initialize(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn list(&self, source_id: Option<&str>) -> Result<Vec<Scope>> {
        let connection = self
            .connection
            .lock()
            .expect("scope repository lock poisoned");
        let sql = "SELECT id, source_id, target_id, name, lifecycle, revision, include_patterns, exclude_patterns, created_at, updated_at FROM scopes WHERE lifecycle != 'deleted' AND (?1 IS NULL OR source_id = ?1) ORDER BY created_at, id";
        let mut stmt = connection.prepare(sql)?;
        let rows = stmt.query_map([source_id], |row| Self::scope_from_row(row))?;
        rows.collect::<Result<Vec<_>>>()?
            .into_iter()
            .map(|mut scope| {
                scope.selections = Self::selections(&connection, &scope.id)?;
                Ok(scope)
            })
            .collect()
    }

    pub fn get(&self, id: &str) -> Result<Option<Scope>> {
        let connection = self
            .connection
            .lock()
            .expect("scope repository lock poisoned");
        let mut stmt = connection.prepare("SELECT id, source_id, target_id, name, lifecycle, revision, include_patterns, exclude_patterns, created_at, updated_at FROM scopes WHERE id = ?1")?;
        let mut rows = stmt.query_map([id], |row| Self::scope_from_row(row))?;
        match rows.next().transpose()? {
            Some(mut scope) => {
                scope.selections = Self::selections(&connection, &scope.id)?;
                Ok(Some(scope))
            }
            None => Ok(None),
        }
    }

    pub fn save(&self, scope: &Scope, expected_revision: Option<i64>) -> Result<bool> {
        let mut connection = self
            .connection
            .lock()
            .expect("scope repository lock poisoned");
        let transaction = connection.transaction()?;
        let exists: Option<i64> = transaction
            .query_row(
                "SELECT revision FROM scopes WHERE id = ?1",
                [&scope.id],
                |row| row.get(0),
            )
            .ok();
        if let (Some(expected), Some(actual)) = (expected_revision, exists) {
            if expected != actual {
                return Ok(false);
            }
        }
        if exists.is_some() {
            transaction.execute("UPDATE scopes SET target_id=?3,name=?4,lifecycle=?5,revision=?6,include_patterns=?7,exclude_patterns=?8,updated_at=?9 WHERE id=?1 AND source_id=?2", params![scope.id, scope.source_id, scope.target_id, scope.name, lifecycle_name(&scope.lifecycle), scope.revision, serde_json::to_string(&scope.include_patterns).unwrap(), serde_json::to_string(&scope.exclude_patterns).unwrap(), scope.updated_at])?;
            transaction.execute(
                "DELETE FROM scope_selections WHERE scope_id=?1",
                [&scope.id],
            )?;
        } else {
            transaction.execute("INSERT INTO scopes (id,source_id,target_id,name,lifecycle,revision,include_patterns,exclude_patterns,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)", params![scope.id, scope.source_id, scope.target_id, scope.name, lifecycle_name(&scope.lifecycle), scope.revision, serde_json::to_string(&scope.include_patterns).unwrap(), serde_json::to_string(&scope.exclude_patterns).unwrap(), scope.created_at, scope.updated_at])?;
        }
        for selection in &scope.selections {
            transaction.execute("INSERT INTO scope_selections (scope_id,node_kind,node_value,recursive,display_name) VALUES (?1,?2,?3,?4,?5)", params![scope.id, selection.node.kind, selection.node.value, selection.recursive, selection.display_name])?;
        }
        transaction.commit()?;
        Ok(true)
    }

    fn scope_from_row(row: &rusqlite::Row<'_>) -> Result<Scope> {
        Ok(Scope {
            id: row.get(0)?,
            source_id: row.get(1)?,
            target_id: row.get(2)?,
            name: row.get(3)?,
            lifecycle: lifecycle_from(&row.get::<_, String>(4)?),
            revision: row.get(5)?,
            selections: vec![],
            include_patterns: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
            exclude_patterns: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }
    fn selections(connection: &Connection, scope_id: &str) -> Result<Vec<ScopeSelection>> {
        let mut stmt = connection.prepare("SELECT node_kind,node_value,recursive,display_name FROM scope_selections WHERE scope_id=?1 ORDER BY node_kind,node_value")?;
        let rows = stmt.query_map([scope_id], |row| {
            Ok(ScopeSelection {
                node: SourceNodeRef {
                    kind: row.get(0)?,
                    value: row.get(1)?,
                },
                recursive: row.get(2)?,
                display_name: row.get(3)?,
            })
        })?;
        rows.collect()
    }
}

fn lifecycle_name(value: &ScopeLifecycle) -> &'static str {
    match value {
        ScopeLifecycle::Active => "active",
        ScopeLifecycle::Paused => "paused",
        ScopeLifecycle::Deleted => "deleted",
    }
}
fn lifecycle_from(value: &str) -> ScopeLifecycle {
    match value {
        "paused" => ScopeLifecycle::Paused,
        "deleted" => ScopeLifecycle::Deleted,
        _ => ScopeLifecycle::Active,
    }
}
