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
         CREATE TABLE IF NOT EXISTS targets (
           id TEXT PRIMARY KEY NOT NULL,
           workspace_path TEXT NOT NULL UNIQUE,
           name TEXT NOT NULL,
           posts_directory TEXT NOT NULL,
           resources_directory TEXT NOT NULL,
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
         );
         CREATE TABLE IF NOT EXISTS snapshots (
           scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
           source_identity TEXT NOT NULL,
           source_path TEXT NOT NULL,
           title TEXT,
           fingerprint TEXT NOT NULL,
           observed_at TEXT NOT NULL,
           PRIMARY KEY (scope_id, source_identity)
         );
         CREATE TABLE IF NOT EXISTS changes (
           id TEXT PRIMARY KEY NOT NULL,
           scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
           change_kind TEXT NOT NULL,
           source_identity TEXT NOT NULL,
           source_path TEXT NOT NULL,
           previous_path TEXT,
           title TEXT,
           selected INTEGER NOT NULL,
           blocked_reason TEXT,
           fingerprint TEXT,
           scanned_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS changes_by_scope ON changes(scope_id, scanned_at, source_path);
         CREATE TABLE IF NOT EXISTS publications (
           batch_id TEXT PRIMARY KEY NOT NULL,
           scope_id TEXT NOT NULL REFERENCES scopes(id),
           target_id TEXT NOT NULL,
           commit_sha TEXT NOT NULL,
           change_ids TEXT NOT NULL,
           state TEXT NOT NULL,
           published_at TEXT,
           rollback_commit_sha TEXT,
           rolled_back_at TEXT
         );
         CREATE INDEX IF NOT EXISTS publications_by_scope ON publications(scope_id, published_at DESC);",
    )?;
    migrate_target_metadata(connection)?;
    migrate_publication_states(connection)
}

fn migrate_target_metadata(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(targets)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    for (name, definition) in [
        ("repository", "TEXT"),
        ("default_branch", "TEXT"),
        ("visibility", "TEXT"),
        ("target_state", "TEXT"),
    ] {
        if !columns.iter().any(|column| column == name) {
            connection.execute(
                &format!("ALTER TABLE targets ADD COLUMN {name} {definition}"),
                [],
            )?;
        }
    }
    connection.execute("UPDATE targets SET repository = COALESCE(repository, 'Legacy local repository'), default_branch = COALESCE(default_branch, ''), visibility = COALESCE(visibility, 'private'), target_state = COALESCE(target_state, 'needs_reconnect')", [])?;
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS targets_repository_branch ON targets(repository, default_branch) WHERE repository != 'Legacy local repository'", [])?;
    Ok(())
}

fn migrate_publication_states(_connection: &Connection) -> Result<()> {
    // Publication state is stored as text, so introducing rollback_pending requires
    // no table rewrite and remains compatible with existing publication rows.
    Ok(())
}
