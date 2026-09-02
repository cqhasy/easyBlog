use rusqlite::{Connection, Result};

pub struct Database;

pub fn initialize(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS sources (
           id TEXT PRIMARY KEY NOT NULL,
           path TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL,
           source_type TEXT NOT NULL,
           created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS scopes (
           id TEXT PRIMARY KEY NOT NULL,
           source_id TEXT NOT NULL REFERENCES sources(id),
           target_id TEXT,
           name TEXT NOT NULL,
           lifecycle TEXT NOT NULL,
           revision INTEGER NOT NULL,
           include_patterns TEXT NOT NULL,
           exclude_patterns TEXT NOT NULL,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS scope_selections (
           scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
           node_kind TEXT NOT NULL,
           node_value TEXT NOT NULL,
           recursive INTEGER NOT NULL,
           display_name TEXT NOT NULL,
           PRIMARY KEY (scope_id, node_kind, node_value)
         );",
    )
}
