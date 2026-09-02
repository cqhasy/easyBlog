# Local Markdown Source Registration Design

**Goal:** Add, validate, persist, and list local directory sources without scanning or publishing.

## Scope

The first vertical slice registers a local directory as a source. The backend canonicalizes the path, verifies it is an accessible directory, stores source metadata in SQLite, and exposes add/list Tauri commands. The frontend sources page presents add, loading, empty, error, and list states.

The slice does not implement scopes, traversal, change detection, GitHub, Feishu, or scheduling. A source is a local root directory; later scanning decides which Markdown files participate.

## Contract

```text
Source {
  id: string,
  path: string,          // canonical absolute path
  name: string,
  type: "local_directory",
  created_at: string     // UTC-compatible timestamp
}
```

Backend errors use stable codes: `invalid_path`, `not_directory`, `not_readable`, `duplicate_source`, and `storage_error`.

## Data Flow

`sources page -> bridge -> Tauri command -> add_source action -> source validation -> SQLite repository`

`sources page -> bridge -> Tauri command -> list_sources action -> SQLite repository`

Commands remain thin and state owns a shared repository. SQLite lives in the Tauri application data directory and uses a unique constraint on canonical paths. Reopening the database must restore all source records.

## Validation

The action trims the input path, canonicalizes it, rejects missing paths and files, and opens the directory with `read_dir` to prove readability. The stored name is the trimmed user name, the canonical directory's final component when available, or the canonical path itself for a filesystem root.

## Testing

Rust tests cover valid registration, duplicate canonical paths, file paths, missing paths, unreadable paths where the platform permits creating one, and persistence after reopening the database. TypeScript tests cover bridge command names/payloads and source-page loading, empty, error, and success states.
