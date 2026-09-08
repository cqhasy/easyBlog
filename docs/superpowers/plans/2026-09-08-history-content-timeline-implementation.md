# History Content Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Git-oriented History table with an accessible, content-first publication timeline backed by immutable ledger operation summaries.

**Architecture:** Add a read-only Rust ledger projection joining recorded operations, binding revisions, outputs, and source transitions. `list_publications` returns that projection as nullable ordered operations. The TypeScript feature turns each batch into an expandable chronological event without changing retry or rollback semantics.

**Tech Stack:** Rust, rusqlite, Tauri, TypeScript, Vitest, vanilla DOM, CSS, Lucide.

**Spec:** `docs/superpowers/specs/2026-09-08-history-content-timeline-design.md`

## Global Constraints

- Derive History summaries only from immutable ledger tables; never read mutable source content, pending changes, bodies, hashes, blob IDs, or source identities.
- Keep ledger ordinal order and classify `write` without `before_hash` as `added`, `write` with a `before_hash` as `updated`, and `delete` as `deleted`.
- Legacy records return `operations: null`, never invented object summaries, and never automatic rollback.
- Preserve command contracts, focus restoration, and the existing duplicate submission guard.
- Use Chinese copy, native expansion buttons, text-plus-color statuses, and an accessible icon-only Lucide refresh control.
- Keep the neutral desktop utility style: rail, dividers, compact badges, no card grid, no source bodies/diffs/filters/search/analytics.
- Do not modify unrelated untracked path `32872`.

---

## File Structure

- `backend/src/storage/ledger.rs`: immutable `HistoryOperation` projection and ledger tests.
- `backend/src/commands/history.rs`: response mapping and command tests.
- `src/contracts/models.ts`: nullable `PublicationRecord.operations` contract.
- `src/features/history/index.ts`: timeline renderer, expansion state, existing actions.
- `src/features/history/index.test.ts`: observable behavior tests.
- `src/styles.css`: desktop-first timeline and responsive styles.

### Task 1: Immutable History Operation Projection

**Files:**
- Modify: `backend/src/storage/ledger.rs:21-34, 209-219, 698-906`
- Modify: `backend/src/commands/history.rs:1-69`
- Test: `backend/src/storage/ledger.rs:698-906`

**Interfaces:**
- Produces `LedgerRepository::load_history_operations(&self, batch_id: &str) -> rusqlite::Result<Vec<HistoryOperation>>`.
- Produces serializable `HistoryOperation { target_path, object_kind, change_kind, display_name }` and snake_case `HistoryObjectKind::{Article, Resource}` / `HistoryChangeKind::{Added, Updated, Deleted}`.
- Produces `HistoryRecord.operations: Option<Vec<HistoryOperation>>`.

- [ ] **Step 1: Write the failing ledger projection tests**

Add `history_operations_keep_ledger_order_and_classify_immutable_operations` beside existing ledger tests. Create a fixture containing article add/delete and resource update operations; assert ordinal order, `article`/`resource`, `added`/`updated`/`deleted`, and titles from the batch transition. Add `history_operations_fall_back_to_target_basename_without_a_title`, expecting `untitled.md` for absent transition titles.

- [ ] **Step 2: Verify the new tests fail correctly**

Run `cargo test history_operations_ --manifest-path backend/Cargo.toml`.

Expected: the tests fail because the projection types and `load_history_operations` do not exist.

- [ ] **Step 3: Implement the minimal immutable projection**

Add types near `LedgerOperation`. Query `release_operations` ordered by `ordinal`, join `release_binding_transitions` by batch/binding, obtain output kind from a matching target path in either immutable before/after binding revision, join `article_bindings` to its immutable source identity, then join the same batch’s `release_source_transitions`. Articles use `after_title`, then `before_title`; resources and missing/ambiguous titles use `Path::file_name()` from stored `target_path`. Return an error for unknown operation/output values.

- [ ] **Step 4: Verify projection tests pass**

Run `cargo test history_operations_ --manifest-path backend/Cargo.toml`.

Expected: PASS.

- [ ] **Step 5: Write failing record mapping tests**

Extract a pure helper in `backend/src/commands/history.rs`. Add `history_record_serializes_ledger_operation_summaries`, asserting `operations.unwrap()[0].display_name == "Release notes"`, and `legacy_history_record_has_no_operation_projection`, asserting `operations.is_none()` and `!rollback_available`.

- [ ] **Step 6: Verify record mapping tests fail correctly**

Run `cargo test history_record_ --manifest-path backend/Cargo.toml`.

Expected: FAIL because `HistoryRecord` has no `operations` field and mapping has not passed through the ledger projection.

- [ ] **Step 7: Implement response mapping**

For ledger-backed publications call `load_history_operations` exactly once, use non-emptiness for rollback eligibility, and serialize `Some(operations)`. Missing batches keep the existing legacy reason/status and serialize `None`. Convert every ledger read error to the existing page-level `storage_error`; do not emit partial records.

- [ ] **Step 8: Verify backend history behavior**

Run `cargo test history_ --manifest-path backend/Cargo.toml`.

Expected: PASS, including projection, legacy, and existing migration/error tests.

- [ ] **Step 9: Commit the contract**

Run `git add backend/src/storage/ledger.rs backend/src/commands/history.rs` then `git commit -m "feat: expose immutable history operations"`.

### Task 2: Typed Content-First Timeline Rendering

**Files:**
- Modify: `src/contracts/models.ts:38-53`
- Modify: `src/features/history/index.ts:1-120`
- Modify: `src/features/history/index.test.ts:1-170`

**Interfaces:**
- Consumes `PublicationRecord.operations: PublicationOperation[] | null`.
- Produces `renderHistory(records, message, expandedBatchIds)` with timeline/event/operation markup.
- Produces `mountHistory()` expansion state without modifying retry or rollback requests.

- [ ] **Step 1: Write failing content-first render tests**

Extend `publishedRecord()` with four ordered operations. Add a test asserting the default output includes `Release notes`, `新增`, `posts/release-notes.md`, and `展开全部 4 项`, but does not include the commit SHA or `批次 batch-published` outside audit disclosure. Add an expanded test using `new Set(["batch-published"])`, asserting the fourth object and `aria-expanded="true"` appear.

- [ ] **Step 2: Verify render tests fail correctly**

Run `npm test -- src/features/history/index.test.ts`.

Expected: FAIL because the model lacks operations, render has no expansion state, and the table centers audit identifiers.

- [ ] **Step 3: Implement typed rendering helpers**

Define `PublicationObjectKind`, `PublicationChangeKind`, and `PublicationOperation` in `models.ts`; extend `PublicationRecord` with `operations`. In History render helpers, use `Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`; keep null time visibly pending. Default to three operations, render object kind/change kind/name/path, place all audit IDs only inside `<details class="history-audit">`, and render expansion as a native `data-action="toggle-history-event"` button with `aria-expanded`.

- [ ] **Step 4: Verify render tests pass**

Run `npm test -- src/features/history/index.test.ts`.

Expected: new content-first tests pass; fix only fixture type errors exposed in existing tests.

- [ ] **Step 5: Write failing state/action tests**

Add tests proving `pending_push` shows `重试推送` but not `回滚`, legacy includes `单项文件变更不可用` without `history-operation`, and clicking `toggle-history-event` rerenders expanded content through the current DOM-root helper.

- [ ] **Step 6: Verify state/action tests fail correctly**

Run `npm test -- src/features/history/index.test.ts`.

Expected: FAIL because generic unavailable copy remains and `mountHistory` does not retain expanded batches.

- [ ] **Step 7: Implement expansion and state behavior**

Maintain `const expandedBatchIds = new Set<string>()` in `mountHistory`; toggle before rendering. Keep `operationPending`, retry calls, dialog focus restoration, and confirmation action unchanged. Use a Lucide icon-only refresh control with `aria-label` and `title` both `刷新发布历史`. Keep retry as text action and rollback only in eligible overflow. Use `operations?.length ?? change_ids.length` in the rollback dialog count.

- [ ] **Step 8: Verify History behavior**

Run `npm test -- src/features/history/index.test.ts`.

Expected: PASS for time/name/type priority, expansion, valid retry behavior, legacy explanation, and guarded rollback.

- [ ] **Step 9: Commit the rendering layer**

Run `git add src/contracts/models.ts src/features/history/index.ts src/features/history/index.test.ts` then `git commit -m "feat: render publication history as content timeline"`.

### Task 3: Timeline Visual System and Verification

**Files:**
- Modify: `src/styles.css:694-718, 765-768`
- Modify: `src/features/history/index.ts`
- Test: `src/features/history/index.test.ts`

**Interfaces:**
- Consumes timeline classes from Task 2.
- Produces readable wide/narrow desktop timeline layout without clipped status/actions.

- [ ] **Step 1: Write a failing semantic structure test**

Assert History output includes `class="history-timeline"`, `aria-label="发布记录时间线"`, and `class="history-event"`.

- [ ] **Step 2: Verify it fails correctly**

Run `npm test -- src/features/history/index.test.ts`.

Expected: FAIL because the old output has `.history-list` and `.history-row`.

- [ ] **Step 3: Implement semantic timeline markup and CSS**

Replace table headings/rows with aggregate/legend, month headings, labelled ordered timeline, date track, rail, event content, operation rows, disclosure, and overflow. Use `.history-event { display: grid; grid-template-columns: 116px 18px minmax(0, 1fr); }` and a one-pixel `.history-rail::before`. Give content `min-width: 0` and `overflow-wrap: anywhere`; use stable icon/overflow dimensions. At 1000px retain the rail with a 92px date track; at 560px stack date/content while retaining reachable actions. Delete obsolete selectors only after markup no longer emits them.

- [ ] **Step 4: Verify the History suite passes**

Run `npm test -- src/features/history/index.test.ts`.

Expected: PASS.

- [ ] **Step 5: Audit against current Web Interface Guidelines**

Fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` and audit History markup/CSS. Fix concrete violations only: icon accessible name/tooltip, native controls, stable targets, text-plus-color status, and absence of overlapping/clipped content at target widths.

- [ ] **Step 6: Run full automated verification**

Run `npm test`, `npm run build`, `cargo test --manifest-path backend/Cargo.toml`, and `git diff --check`.

Expected: all pass; separately note any pre-existing Vite bundle-size warning.

- [ ] **Step 7: Start and inspect the application**

Run `npm run dev -- --host 127.0.0.1 --port 58675`, selecting another local port only if occupied. Inspect History at approximately 1440px and 900px: collapsed, expanded, pending, recovery, legacy, empty, loading, and rollback confirmation. Confirm default rows contain no commit/batch identifiers and no overlaps or clipping occur.

- [ ] **Step 8: Commit the visual layer**

Run `git add src/styles.css src/features/history/index.ts src/features/history/index.test.ts` then `git commit -m "style: refine history content timeline"`.

## Self-Review

**Spec coverage:** Task 1 covers immutable ordered summaries and legacy null behavior. Task 2 covers content hierarchy, expansion, audit disclosure, localized time, state actions, and rollback safeguards. Task 3 covers the rail/divider visual language, responsiveness, guideline audit, and visual verification. Deliberate exclusions remain untouched.

**Placeholder scan:** No TODO/TBD marker or unspecified test/command remains.

**Type consistency:** Rust `HistoryOperation` serializes the same snake_case fields that TypeScript `PublicationOperation` consumes. Both `PublicationRecord.operations` representations are nullable only for legacy/no-ledger data.
