# Add and List a Local Markdown Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register accessible local directory sources through SQLite and Tauri, then render them in the sources page across restarts.

**Architecture:** Define serializable Source and AppError contracts shared by Rust and TypeScript. A repository owns SQLite schema/queries, an action validates and orchestrates registration, Tauri commands delegate to the action, and the frontend bridge/page manages async state.

**Tech Stack:** Rust 2021, Tauri 2, rusqlite, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-local-source-registration-design.md`

## Global Constraints

- Single-user, single-machine, local-first desktop application; Windows and macOS are v1 targets.
- SQLite stores source metadata only and never article bodies, tokens, secrets, or authorization headers.
- Commands remain thin; actions orchestrate; storage owns SQLite.
- This slice excludes scopes, scanning, publishing, GitHub, Feishu, and scheduling.

---

### Task 1: Backend contracts and SQLite source repository

**Files:**
- Modify: `backend/Cargo.toml`, `backend/src/sources/source.rs`, `backend/src/shared/errors.rs`, `backend/src/storage/database.rs`, `backend/src/storage/sources.rs`, `backend/src/storage/mod.rs`
- Test: Rust unit tests in `backend/src/storage/sources.rs` and `backend/src/storage/database.rs`

**Interfaces:**
- Produces `Source`, `SourceRepository::open`, `insert`, and `list` for later actions.

- [ ] **Step 1: Write failing repository tests** for schema creation, insert/list, duplicate path rejection, and reopen persistence using a temporary SQLite file.
- [ ] **Step 2: Run `cargo test --manifest-path backend/Cargo.toml storage::sources` and confirm failure because the repository is still a stub.**
- [ ] **Step 3: Add rusqlite, create the `sources` table with a unique canonical path, implement typed rows and repository methods.**
- [ ] **Step 4: Run the focused tests and confirm they pass.**

### Task 2: Add-source action and Tauri state/commands

**Files:**
- Modify: `backend/src/actions/add_source.rs`, `backend/src/actions/mod.rs`, `backend/src/commands/sources.rs`, `backend/src/commands/mod.rs`, `backend/src/app/state.rs`, `backend/src/app/wiring.rs`, `backend/src/lib.rs`, `backend/src/shared/errors.rs`
- Test: Rust action tests in `backend/src/actions/add_source.rs`

**Interfaces:**
- Consumes `SourceRepository` from Task 1.
- Produces `add_source(path: String, name: Option<String>) -> AppResult<Source>` and `list_sources() -> AppResult<Vec<Source>>` command handlers.

- [ ] **Step 1: Write failing action tests** for valid directory, file path, missing path, duplicate canonical directory, and persisted list.
- [ ] **Step 2: Run `cargo test --manifest-path backend/Cargo.toml actions::add_source` and confirm expected failures.**
- [ ] **Step 3: Implement canonicalization/readability validation, stable error codes, managed shared state, command registration, and app-data SQLite initialization.**
- [ ] **Step 4: Run backend tests and `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`.**

### Task 3: Frontend bridge and sources page

**Files:**
- Modify: `src/contracts/models.ts`, `src/contracts/errors.ts`, `src/contracts/index.ts`, `src/bridge/sources.ts`, `src/features/sources/index.ts`, `src/app/bootstrap.ts`, `src/app/routes.ts`
- Create: `src/features/sources/index.test.ts`, `src/bridge/sources.test.ts`

**Interfaces:**
- Consumes Tauri commands `list_sources` and `add_source` with the Task 2 payloads.
- Produces a rendered sources page and typed `listSources`/`addSource` bridge functions.

- [ ] **Step 1: Write failing Vitest tests** for command payloads and loading, empty, error, success, and add-refresh states.
- [ ] **Step 2: Run `npm test -- src/bridge/sources.test.ts src/features/sources/index.test.ts` and confirm failure.**
- [ ] **Step 3: Implement typed bridge calls and a desktop-first sources view with accessible labels, status text, and no scan/publish controls.**
- [ ] **Step 4: Run focused tests and `npm run build`.**

### Task 4: Full verification

**Files:**
- Modify only files needed to resolve verification failures.

- [ ] **Step 1: Run `npm test`.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Run `cargo test --manifest-path backend/Cargo.toml`.**
- [ ] **Step 4: Review the diff against the spec and confirm no scope, scan, publish, GitHub, Feishu, or scheduler behavior was added.**
