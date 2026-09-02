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
         );",
    )
}
