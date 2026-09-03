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
           snapshots_before_publish TEXT,
           state TEXT NOT NULL,
           published_at TEXT,
           rollback_commit_sha TEXT,
           rolled_back_at TEXT
         );
         CREATE INDEX IF NOT EXISTS publications_by_scope ON publications(scope_id, published_at DESC);",
    )?;
    migrate_target_metadata(connection)?;
    migrate_publication_states(connection)?;
    migrate_publication_snapshots(connection)?;
    migrate_release_ledger(connection)
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
        ("adapter", "TEXT"),
    ] {
        if !columns.iter().any(|column| column == name) {
            connection.execute(
                &format!("ALTER TABLE targets ADD COLUMN {name} {definition}"),
                [],
            )?;
        }
    }
    connection.execute("UPDATE targets SET repository = COALESCE(repository, 'Legacy local repository'), default_branch = COALESCE(default_branch, ''), visibility = COALESCE(visibility, 'private'), target_state = COALESCE(target_state, 'needs_reconnect')", [])?;
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS targets_repository_branch ON targets(repository COLLATE NOCASE, default_branch) WHERE repository != 'Legacy local repository'",
        [],
    )?;
    Ok(())
}

fn migrate_publication_states(_connection: &Connection) -> Result<()> {
    // Publication state is stored as text, so introducing rollback_pending requires
    // no table rewrite and remains compatible with existing publication rows.
    Ok(())
}

fn migrate_publication_snapshots(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA table_info(publications)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !columns
        .iter()
        .any(|column| column == "snapshots_before_publish")
    {
        connection.execute(
            "ALTER TABLE publications ADD COLUMN snapshots_before_publish TEXT",
            [],
        )?;
    }
    Ok(())
}

fn migrate_release_ledger(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS article_bindings (
           binding_id TEXT PRIMARY KEY NOT NULL,
           target_id TEXT NOT NULL REFERENCES targets(id),
           scope_id TEXT NOT NULL REFERENCES scopes(id),
           source_identity TEXT NOT NULL,
           state TEXT NOT NULL,
           current_revision_id TEXT,
           UNIQUE(target_id, source_identity)
         );
         CREATE INDEX IF NOT EXISTS article_bindings_by_scope ON article_bindings(scope_id, target_id);
         CREATE TABLE IF NOT EXISTS binding_revisions (
           revision_id TEXT PRIMARY KEY NOT NULL,
           binding_id TEXT NOT NULL REFERENCES article_bindings(binding_id),
           revision_number INTEGER NOT NULL,
           state TEXT NOT NULL,
           UNIQUE(binding_id, revision_number)
         );
         CREATE TABLE IF NOT EXISTS binding_outputs (
           revision_id TEXT NOT NULL REFERENCES binding_revisions(revision_id) ON DELETE CASCADE,
           target_path TEXT NOT NULL,
           content_hash TEXT NOT NULL,
           git_blob_sha TEXT,
           output_kind TEXT NOT NULL,
           PRIMARY KEY (revision_id, target_path)
         );
         CREATE TABLE IF NOT EXISTS target_revisions (
           target_id TEXT PRIMARY KEY NOT NULL REFERENCES targets(id),
           sequence INTEGER NOT NULL DEFAULT 0,
           head_sha TEXT,
           active_batch_id TEXT
         );
         CREATE TABLE IF NOT EXISTS release_batches (
           batch_id TEXT PRIMARY KEY NOT NULL,
           scope_id TEXT NOT NULL REFERENCES scopes(id),
           target_id TEXT NOT NULL REFERENCES targets(id),
           change_ids TEXT NOT NULL DEFAULT '[]',
           scope_revision INTEGER NOT NULL,
           target_sequence_before INTEGER NOT NULL,
           target_head_before TEXT NOT NULL,
           state TEXT NOT NULL,
           created_at TEXT NOT NULL,
           previewed_at TEXT,
           commit_sha TEXT,
           published_at TEXT,
           rollback_commit_sha TEXT,
           rolled_back_at TEXT,
           failure_code TEXT
         );
         CREATE INDEX IF NOT EXISTS release_batches_by_target ON release_batches(target_id, created_at DESC);
         CREATE TABLE IF NOT EXISTS release_operations (
           operation_id TEXT PRIMARY KEY NOT NULL,
           batch_id TEXT NOT NULL REFERENCES release_batches(batch_id) ON DELETE CASCADE,
           ordinal INTEGER NOT NULL,
           binding_id TEXT NOT NULL REFERENCES article_bindings(binding_id),
           target_path TEXT NOT NULL,
           operation_kind TEXT NOT NULL,
           before_hash TEXT,
           after_hash TEXT,
           before_blob_sha TEXT,
           after_blob_sha TEXT,
           UNIQUE(batch_id, ordinal),
           UNIQUE(batch_id, target_path)
         );
         CREATE TABLE IF NOT EXISTS release_binding_transitions (
           batch_id TEXT NOT NULL REFERENCES release_batches(batch_id) ON DELETE CASCADE,
           binding_id TEXT NOT NULL REFERENCES article_bindings(binding_id),
           before_revision_id TEXT REFERENCES binding_revisions(revision_id),
           after_revision_id TEXT REFERENCES binding_revisions(revision_id),
           PRIMARY KEY (batch_id, binding_id)
         );
         CREATE TABLE IF NOT EXISTS release_source_transitions (
           batch_id TEXT NOT NULL REFERENCES release_batches(batch_id) ON DELETE CASCADE,
           source_identity TEXT NOT NULL,
           source_path TEXT NOT NULL,
           before_fingerprint TEXT,
           after_fingerprint TEXT,
           PRIMARY KEY (batch_id, source_identity)
         );
         CREATE TABLE IF NOT EXISTS release_conflicts (
           conflict_id TEXT PRIMARY KEY NOT NULL,
           batch_id TEXT NOT NULL REFERENCES release_batches(batch_id) ON DELETE CASCADE,
           target_path TEXT NOT NULL,
           conflict_code TEXT NOT NULL,
           expected_hash TEXT,
           actual_hash TEXT,
           created_at TEXT NOT NULL,
           UNIQUE(batch_id, target_path, conflict_code)
         );",
    )?;
    let mut statement = connection.prepare("PRAGMA table_info(release_batches)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !columns.iter().any(|column| column == "change_ids") {
        connection.execute(
            "ALTER TABLE release_batches ADD COLUMN change_ids TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    Ok(())
}
