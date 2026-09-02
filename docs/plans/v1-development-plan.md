# easyBlog v1 Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver every capability in the v1 PRD as a testable Tauri desktop workflow: configure sources and scopes, detect and review changes, publish confirmed batches to GitHub, and recover safely from failures.

**Architecture:** Keep the existing modular monolith boundaries. Tauri commands remain thin; actions orchestrate user workflows; capability modules own rules; providers adapt Local, Feishu, GitHub, and Git; storage owns SQLite persistence; credentials use the OS keychain. Shared contracts are frozen before feature tracks open so independent work can proceed without interface churn.

**Tech Stack:** TypeScript, Vite, Vitest, Tauri 2, Rust, SQLite, easyBlog-managed Git workspaces, GitHub CLI/API, Feishu APIs, system keychain.

**Spec:** `docs/PRD.md`, `docs/architecture.md`, `docs/prd/*.md`, and `docs/decisions/frontend-design.md`.

## Global Constraints

- Single-user, single-machine, local-first desktop application; Windows and macOS are v1 targets.
- Sources publish one way to GitHub; GitHub never writes back.
- A source article has at most one binding; duplicate inclusion, slug conflicts, and target-side external edits block only affected items.
- Deletions enter a confirmation list and never delete online files automatically.
- SQLite stores IDs, scopes, snapshots, changes, releases, and history, but never tokens, secrets, authorization headers, or article body content.
- Logs contain only operation metadata, redacted paths, and document IDs; diagnostics export is redacted before writing.
- Any permission, network, conversion, mapping, slug, or target-state uncertainty stops the affected operation without overwrite or success marking.
- Detection and publication are separate actions; the default schedule is 30 minutes and manual detection is always available.
- The v1 UI is desktop-first with fixed navigation, onboarding, change review, diff preview, release progress, retry, and history rollback.

## Ownership and Collaboration Model

Use role ownership rather than person names so the plan survives staffing changes:

| Track | Owner role | Primary areas |
| --- | --- | --- |
| Core domain | Domain engineer | `contracts`, `content`, `tracking`, `changes`, `scopes`, `storage` |
| Release | Release engineer | `targets`, `workspace`, `releases`, Git/GitHub providers |
| Integrations | Integration engineer | Local, Feishu auth/docs/wiki/assets providers |
| Client and quality | Client engineer + QA | `src/features`, `src/bridge`, Tauri command integration, fixtures and E2E |

Every task follows: design review -> failing test -> minimal implementation -> focused test -> integration check -> commit. A track may start only when its listed contract dependency is merged.

## Dependency Graph and Parallel Batches

```text
M0 Foundation Contracts & Delivery Baseline
  ├── M1 Local Source Sync Vertical Slice
  ├── M2 GitHub Target & Release Pipeline
  └── M3 Feishu Documents
M1 + M2 + M3
  └── M4 Feishu Wiki, Scheduling, Conflicts & Recovery
M4
  └── M5 Release Readiness
```

Within the graph, M1 source scanning, M2 target/release mechanics, and M3 Feishu document conversion may run in parallel after M0. Frontend slices can run beside their backend track once the TypeScript contracts are frozen. M4 is intentionally after the first three slices because it composes their conflict, retry, and scheduling states.

## Milestones and Tasks

### M0: Foundation Contracts & Delivery Baseline (serial gate)

**Outcome:** A runnable shell with stable domain contracts, migrations, command wiring, test fixtures, and CI gates.

1. **Freeze contracts and errors** (Core + Client). Modify `src/contracts/models.ts`, `src/contracts/errors.ts`, `src/contracts/index.ts`, `backend/src/shared/ids.rs`, `backend/src/shared/errors.rs`, and add contract tests under `tests/contracts/`. Define `Source`, `Scope`, `Target`, `Snapshot`, `Change`, `ReleaseBatch`, `Publication`, typed IDs, and serializable error codes. Test JSON round-trips and redaction-safe error serialization.
2. **Create SQLite schema and repositories** (Core). Modify `backend/src/storage/database.rs`, add `backend/src/storage/migrations/0001_v1.sql`, and complete `sources.rs`, `scopes.rs`, `snapshots.rs`, `changes.rs`, `releases.rs`, and `publications.rs`. Enforce unique bindings, foreign keys, migration rollback checks, and “metadata only” storage tests using an in-memory database.
3. **Wire Tauri state and command boundaries** (Core + Client). Modify `backend/src/app/state.rs`, `backend/src/app/wiring.rs`, `backend/src/commands/*.rs`, `backend/src/actions/mod.rs`, and add `src/bridge/*.ts`. Commands must parse input, call one action, and map typed errors; add one integration test proving a command cannot access provider/storage internals directly.
4. **Establish test and CI gates** (Client + QA). Add `tests/fixtures/`, Rust integration harnesses, and CI checks in `.github/workflows/`. Make `npm run build`, `npm test`, `cargo test --manifest-path backend/Cargo.toml`, and `cargo fmt --manifest-path backend/Cargo.toml --all -- --check` required checks. Commit M0 only after all four commands pass.

**M0 gate:** Contracts reviewed, migration applies cleanly, app starts, and all required checks pass on Windows and macOS runners.

### M1: Local Source Sync Vertical Slice (parallel after M0)

**Outcome:** A user can add a local Markdown directory, configure a scope, detect changes, inspect them, and persist snapshots without publishing.

1. **Complete local source and scope actions** (Integration + Core). Extend `backend/src/providers/local/reader.rs` and `file_tree.rs`; implement `backend/src/actions/add_source.rs` and `configure_scope.rs`; persist source roots, recursive selection, include/exclude rules, pause state, and target binding. Add traversal, symlink, permission, and non-Markdown fixture tests.
2. **Normalize Markdown content** (Core). Implement `backend/src/content/article.rs`, `markdown.rs`, `frontmatter.rs`, `slug.rs`, `resource.rs`, and `conversion_warning.rs`. Define deterministic front matter, slug collision reporting, UTF-8 handling, and resource references. Add golden tests for headings, code blocks, tables, links, malformed front matter, and unsupported content.
3. **Implement snapshot scan and comparison** (Core). Implement `backend/src/tracking/{snapshot,fingerprint,identity,binding_lookup}.rs` and `backend/src/changes/{scan,compare,change,conflict,change_set}.rs`; complete `backend/src/actions/scan_scope.rs`. Test added, updated, moved, deleted, duplicate-binding, slug-conflict, and unchanged cases with deterministic timestamps and hashes.
4. **Build source, changes, onboarding, and workspace states** (Client). Replace feature stubs in `src/features/sources/index.ts`, `src/features/changes/index.ts`, `src/features/onboarding/index.ts`, and `src/app/routes.ts`; add bridge calls and loading/error/empty states. Verify source tree selection and grouped change rendering against the confirmed frontend decisions.
5. **Run local vertical integration** (QA). Use a temporary directory fixture to add a source, scan twice, mutate files, and assert persisted `ChangeSet` and snapshot rows. Record evidence in `changes.md` and commit the milestone.

**M1 gate:** Local add -> configure -> scan -> review works end to end; deletion remains unselected; conflicts are visible and blocked; no article body is written to SQLite.

### M2: GitHub Target & Release Pipeline (parallel after M0; consumes M1 contracts)

**Outcome:** A confirmed local change can be previewed, staged, committed, pushed, retried, or rolled back through a protected Git workspace.

1. **Configure publishing targets and template adapters** (Release). Complete `backend/src/targets/{target,layout,template,target_check}.rs`. After repository connection, require the author to confirm an adapter, article directory, resource directory, and any initialization before a Target becomes publishable. Validate the configured layout, derive article/resource paths, and generate `.github/easyblog.yml` only when the selected adapter requires it. Add layout mismatch, slug, generated-file, and non-Jekyll directory golden tests.
2. **Implement GitHub authorization, repository connection, workspace isolation and diff** (Release). Complete `backend/src/providers/github/auth.rs`, GitHub target connection commands, `backend/src/workspace/{checkout,working_tree,diff,file_lock,commit_log}.rs`, and `backend/src/providers/git/{commands,parser}.rs`. Reuse `gh auth login --web --clipboard --git-protocol https` with a startup status check; v1 lists current-account repositories with push permission and accepts only `github.com` HTTPS repositories. The user selects `owner/repo`; easyBlog clones it into application data, reuses one target per repository/default branch, and never modifies an existing user clone. Connection must not infer or create a blog layout; configuration is a separate step. Lock one workspace per target, fast-forward only after safe fetch checks, reject dirty/external/ahead states, and expose structured file diffs. Test authorization status/error mapping separately from temporary Git repositories and concurrent lock attempts.
3. **Implement release planning and execution** (Release). Complete `backend/src/releases/{batch,plan,file_set,stage,commit,push,rollback}.rs` and actions `preview_release.rs`, `publish_release.rs`, `retry_release.rs`, `rollback_publication.rs`. Define idempotent stage/commit boundaries, commit-SHA publication records, partial failure states, and reverse rollback commits. Test success, push failure, retry, and rollback without rewriting remote history.
4. **Build release and history client flows** (Client). Implement `src/features/releases/index.ts`, `src/features/history/index.ts`, and `src/bridge/{releases,history}.ts` with one confirmed release batch per configured Scope, diff preview, progress, retry, and rollback menu states. Add UI contract tests for blocked items and delete confirmation.
5. **Run release E2E** (QA). In a temporary bare remote, scan a fixture, preview, confirm, commit, push, inspect history, force an external edit, and verify the affected item is blocked while unrelated items remain publishable. Record commit SHA and rollback evidence in `changes.md`.

**M2 gate:** No publish path bypasses preview or confirmation; external target edits, push failures, and uncertain states never mark success.

### M3: Feishu Documents (parallel after M0; consumes content contracts)

**Outcome:** OAuth-authenticated Feishu documents can be selected, converted to Markdown with assets and warnings, and enter the same change pipeline as local articles.

1. **Implement secure Feishu credential flow** (Integration). Complete `backend/src/credentials/{keychain,feishu}.rs` and `backend/src/providers/feishu/auth.rs`. Store app secret and refresh token only in the system keychain; test missing permission, expired token, refresh, and redacted diagnostics.
2. **Implement document read and block conversion** (Integration). Complete `backend/src/providers/feishu/{docs,blocks,assets}.rs`; map document IDs, headings, code, tables, links, images, and attachments to the content model. Add fixture-based conversion tests and warning assertions for comments, permissions, and unsupported interactive blocks.
3. **Add Feishu document source and scope UI** (Client). Extend `src/features/sources/index.ts`, `src/features/onboarding/index.ts`, and `src/bridge/sources.ts` with OAuth status, permission checks, ID-based selection, recursive scope configuration, and actionable errors.
4. **Run provider integration tests** (QA). Mock Feishu HTTP responses, assert no credentials/body content enter SQLite or logs, and feed converted documents through the M1 scan/compare tests. Record API fixtures and known limitations in `changes.md`.

**M3 gate:** A document can be selected by ID, converted deterministically, assets are placed under the target resource directory, and permission/conversion uncertainty blocks only the affected item.

### M4: Feishu Wiki, Scheduling, Conflicts & Recovery (after M1-M3)

**Outcome:** The remaining PRD behaviors compose across all sources and are observable and recoverable.

1. **Implement Feishu wiki traversal** (Integration). Complete `backend/src/providers/feishu/wiki.rs` for node-ID traversal, recursive selection, pagination, and inaccessible-node reporting. Add fixtures for moved nodes, deleted nodes, pagination, and partial permissions.
2. **Implement scheduler** (Core). Complete `backend/src/scheduler/{schedule,runner,jobs}.rs`; support 10 minutes, 30 minutes, 1 hour, 6 hours, daily, and off; run once on startup, never on exit, and never auto-publish. Test schedule calculation, cancellation, and duplicate-run prevention.
3. **Harden conflict and recovery orchestration** (Core + Release). Extend `changes/conflict.rs`, `releases/retry_release.rs`, `rollback.rs`, `storage/publications.rs`, and `diagnostics/{logging,redaction,export}.rs`. Ensure duplicate source overlap, slug conflicts, external edits, permission errors, and conversion warnings produce explicit states; ensure retries are idempotent and rollback creates a new commit.
4. **Complete dashboard and settings flows** (Client). Extend `src/features/settings/index.ts`, dashboard routing/layout, and command palette state. Show last scan, pending changes, blocked summaries, schedule, diagnostics export, and system/light/dark theme states.
5. **Run cross-source integration** (QA). Exercise local, Feishu document, and wiki scopes into one target through separately configured Scopes, verify independent blocked items, retry a failed subset, and roll back a successful publication.

**M4 gate:** All source types share the same normalized change/release contracts; scheduler, diagnostics, conflict isolation, retry, and rollback tests pass.

### M5: Release Readiness & v1 Sign-off (serial)

**Outcome:** A reproducible, supportable desktop release satisfies every PRD acceptance criterion.

1. **Run full verification matrix** (QA). Execute `npm run build`, `npm test`, `cargo test --manifest-path backend/Cargo.toml`, Rust formatting, and the complete temporary-Git/Feishu fixture suite on Windows and macOS. Attach command output and artifact versions to `changes.md`.
2. **Perform security and privacy audit** (Security + Core). Search source, database dumps, logs, diagnostics exports, and packaged artifacts for tokens, secrets, authorization headers, and article bodies; verify keychain-only credentials and redaction tests.
3. **Perform UX and recovery acceptance** (Client + QA). Walk onboarding, source tree, grouped changes, diff preview, delete confirmation, blocked conflicts, progress, retry, history, rollback, empty/error states, and theme switching using the frontend decisions document.
4. **Package and document operations** (Release). Verify Tauri Windows/macOS packaging, migration upgrade path, backup/recovery instructions, supported GitHub Pages layout, known limitations, and rollback procedure. Update `docs/PRD.md` links if any final decisions changed.
5. **Sign off and tag v1** (Release owner). Confirm every gate above, create the v1 tag/release, and add the final evidence entry to `changes.md`.

**M5 gate:** All PRD acceptance items have test or manual evidence, both target platforms build successfully, and rollback/support documentation is complete.

## Definition of Ready / Done

**Ready:** Contract inputs/outputs are named, dependency milestone is merged, fixtures or test data are identified, and the owner role plus acceptance evidence are recorded in the issue/PR.

**Done:** Focused tests pass, integration checks pass, no forbidden secret/body persistence is introduced, UX states are wired for success/loading/error/blocked/empty, docs and `changes.md` are updated, and the change is merged only after the milestone gate is green.

## Change Control and Conflict Reduction

- Contract or migration changes require a short design note and review by Core + Client before implementation tracks continue.
- Each track owns its files; shared files (`src/contracts/*`, `backend/src/shared/*`, `app/wiring.rs`, and migrations) are changed only through explicitly coordinated tasks.
- Parallel PRs must rebase after contract changes and include a focused compatibility test.
- Scope expansion, new provider behavior, or schema changes are recorded in `changes.md` before coding and assigned to a milestone; do not silently enlarge an in-flight task.
- A failed gate pauses only the dependent milestone; independent tracks may continue.

## PRD Coverage Checklist

- [ ] Local directory source, tree, scope selection, include/exclude, pause
- [ ] Feishu document and wiki sources, OAuth, permissions, IDs, recursion
- [ ] Markdown conversion, assets, warnings, slug/front matter
- [ ] Manual and scheduled detection with snapshots and change types
- [ ] Duplicate binding, slug, overlap, and target external-edit conflicts
- [ ] Batch split, preview, confirmation, stage, commit, push
- [ ] Retry, history, reverse rollback commit, no remote history rewrite
- [ ] Keychain credentials, redacted logs/diagnostics, no body/secret persistence
- [ ] Onboarding, dashboard, grouped changes, diff, progress, settings, themes
- [ ] Windows/macOS build and final acceptance evidence
