# History Content Timeline Design

**Status:** Confirmed for implementation
**Date:** 2026-09-08
**Scope:** Desktop History experience and its read-only publication-history contract

## Goal

Make History a readable archive of published content changes. An author should see what content changed, how it changed, and when it was published before encountering Git identifiers or recovery mechanics.

## Confirmed Direction

- The primary unit is a publication batch, represented as one chronological event.
- A batch defaults to a concise preview of its affected content objects. The user expands it to inspect all objects in that batch.
- Every displayed object shows a human-readable name, its change type, and its target path as supporting information.
- Git commit SHA and batch ID are audit details. They are not shown in the default event row.
- The presentation is a content timeline, not a multi-column release table or a dashboard of cards.
- Rollback remains a low-frequency overflow action for an eligible published batch and always opens a confirmation dialog.

## User Job

When an author opens History, they need to answer:

> What did I publish recently, which content objects changed, and is any publication waiting for my attention?

The page is not a generic Git log. It must describe content changes without exposing stored article bodies, credentials, hashes, or diagnostic internals as primary content.

## Information Architecture

```text
History
|
|-- Header: title, short archive context, refresh icon button
|-- Quiet aggregate line: publication count and object count; state legend
`-- Chronological timeline, grouped by month
    `-- Publication event
        |-- Date and time
        |-- Result state
        |-- Batch summary: "N 项内容已发布" or state-specific equivalent
        |-- Target and scope
        |-- First three content-object changes
        |-- Expand all / secondary state action
        `-- Expanded content-object list and low-frequency detail/overflow action
```

No side detail panel is used. The timeline remains the single scanning surface; expanding an event reveals only its own remaining objects and keeps adjacent history visible.

## Publication Event

### Header

Each event renders:

- Calendar day, weekday, and localized 24-hour time.
- A semantic state marker and visible state label.
- A summary based on its operation count: `4 项内容已发布`, `2 项内容等待推送`, `已回滚 3 项内容`, or `发布状态需要恢复`.
- Target name/ID and scope ID as supporting context.

`published` uses green, `pending_push` and `rollback_pending` use amber, `recovery_required` uses red, and `rolled_back`/`legacy` use neutral treatment. Text labels always accompany color.

### Content Objects

The history API returns a sequence of `PublicationOperation` summaries for each non-legacy batch. Each summary is derived only from the immutable release operation ledger and its source transition metadata:

```text
PublicationOperation
  target_path: string
  object_kind: article | resource
  change_kind: added | updated | deleted
  display_name: string
```

- `object_kind` is `article` for Markdown output and `resource` for any generated resource.
- `change_kind` comes from the immutable operation preconditions:
  - `write` with no `before_hash`: `added`
  - `write` with a `before_hash`: `updated`
  - `delete`: `deleted`
- Target layout operations can produce a write and delete pair. They remain two explicit ledger-derived events rather than being inferred as a misleading move.
- `display_name` is the source-transition title when an article transition can be unambiguously associated with the binding; otherwise it is the final segment of `target_path`. Resource display names are always the final path segment.
- Every object retains `target_path` as secondary, monospaced context. No source body, content hash, Git blob ID, or raw source identity is exposed.

The collapsed event shows the first three operation summaries in ledger order. A fourth or later item is represented by `展开全部 N 项`; expanding shows all operations. Resource changes use a distinct visible `资源` label, so a file name never has to communicate type by itself.

### State-Specific Behavior

- `published`: shows object preview, `展开全部`, and an overflow trigger containing `回滚` only when `rollback_available` is true.
- `pending_push`: shows object preview, a concise pending-push notice, and `重试推送` as an explicit secondary text action. It does not offer rollback.
- `rollback_pending`: shows the original objects, notes that the reverse commit awaits push, and offers `重试回滚推送`.
- `rolled_back`: shows the original object list and an `已回滚` label. It does not present a rollback action.
- `recovery_required`: shows the safe, structured recovery explanation and a route to expanded detail; no rollback or retry is enabled unless the state itself permits retry.
- `legacy`: stays visible with target/scope/time and a neutral `旧版记录` label. It explicitly says that individual file changes are unavailable and automatic rollback is unavailable; it does not invent object summaries from mutable data.

## Details and Rollback

Expanded event details expose the complete operation list and a collapsed audit disclosure with commit SHA, batch ID, and rollback commit SHA where available. This information is copyable but remains visually secondary.

The overflow menu contains `回滚` only for a safely eligible published record. Confirmation states the target, operation count, and that it creates and pushes a new reverse commit without rewriting remote history. It preserves the existing focus restoration and duplicate-submission guard.

## Contract Design

The existing `list_publications` contract exposes only `change_ids` and a total count. It cannot truthfully render the confirmed UI, so it will be extended in place:

```text
PublicationRecord
  ...existing fields
  operations: PublicationOperation[] | null

PublicationOperation
  target_path: string
  object_kind: "article" | "resource"
  change_kind: "added" | "updated" | "deleted"
  display_name: string
```

- `operations` is an ordered array for ledger-backed batches, including pending and rolled-back records; it is `null` for legacy records and any record without a safe immutable ledger.
- The backend joins `release_operations`, `release_binding_transitions`, and `release_source_transitions` through immutable IDs already recorded in the ledger. It performs no source re-read and no title/path inference from current mutable content.
- If ledger data cannot be read, `list_publications` continues its existing fail-closed behavior and returns the page-level storage error rather than emitting partial, ambiguous data.
- Existing retry and rollback command contracts are unchanged.

## Visual Rules

- Preserve the established neutral app shell and desktop-first behavior.
- Use a vertical rail, day/time block, generous white space between events, compact change badges, and fine dividers to create rhythm without turning each event into a floating card.
- Use the existing sans-serif UI stack for controls and metadata. A restrained serif page heading may be used only when it fits the actual app typography; no hero-scale type or decorative effects.
- Use Lucide icons in production controls. The refresh control is icon-only with an accessible name and tooltip.
- At narrower desktop widths, retain the vertical rail, wrap event metadata safely, and allow long object names to wrap before target paths. Never truncate the visible state or action.

## Accessibility

- Use a labelled ordered list or list of publication events inside a History landmark.
- Expand controls are native buttons with explicit expanded state and describe the publication they reveal.
- Status is visible text plus semantic color and icon.
- Live regions announce refresh, retry, and rollback lifecycle changes.
- Overflow menu and confirmation dialog retain existing keyboard and focus behavior.
- Dates use `Intl.DateTimeFormat("zh-CN", ...)`; numeric counts use tabular figures.

## Testing and Verification

- Rust command tests prove operation summaries are ledger-derived, ordered, correctly classified, and title/path fall back safely.
- Rust tests prove legacy records return `operations: null` and do not query mutable source content.
- Frontend render tests prove collapsed events prioritize names/types/time and do not render commit SHA in the default event content.
- Frontend tests prove expansion renders remaining items, pending states expose only valid retries, and rollback stays in overflow with its existing confirmation guarantees.
- Run focused Rust and Vitest suites, `npm run build`, `cargo test`, and `git diff --check`.
- Run the current Web Interface Guidelines audit after implementation, then visually inspect wide and narrow desktop History states: populated, expanded, pending push, recovery required, legacy, empty, loading, and rollback confirmation.

## Deliberate Exclusions

- No source-content bodies, diff previews, Git graph, analytics, filters, search, or file-level independent rollback.
- No changes to publication, retry, rollback, ownership, or recovery semantics.
- No reconstruction of history objects from current source files or mutable pending changes.
