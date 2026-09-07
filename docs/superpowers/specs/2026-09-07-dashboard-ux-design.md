# Dashboard UX Design

**Status:** Wireframe confirmed; visual design in discussion
**Date:** 2026-09-07
**Scope:** Authenticated desktop Dashboard only

## Goal

Make the Dashboard the source-centered change overview for easyBlog. In
roughly five seconds, an author should understand whether any configured
content source has changes that need to be reviewed and where to go next.

The Dashboard is a decision and routing surface. It does not own multi-item
selection, content review, publishing, recovery, rollback, or source
configuration.

## Confirmed Decisions

- The primary unit is a configured content source, not a publication batch or
  an analytics metric.
- Dashboard presents every configured source, including sources with no
  changes, so that users can verify the system's coverage.
- The first viewport uses a signal-first hierarchy:
  1. aggregated change signal and next action;
  2. concise operational facts;
  3. a source-status list for diagnosis and routing.
- A source with changes opens `Changes` with that source already selected as
  the active filter.
- A global `Check all` action scans every configured source. Per-source
  scanning stays in `Sources`.
- If a source's latest check failed, Dashboard says that its status is unknown
  and routes to `Sources`. It does not expose diagnostics or recovery controls.
- `History` remains the owner of publication records and rollback. Neither is
  rendered in Dashboard.

## User Job

When an author opens Dashboard, they need to answer:

> Which sources have changed since I last reviewed them, and what should I
> inspect now?

The design optimizes for this decision rather than for a full operational
overview. It uses progressive disclosure: aggregate signal first, source-level
detail next, focused review only after navigation into `Changes`.

## Dashboard State Model

### Source Row

Each configured source provides:

| Field | Purpose |
| --- | --- |
| Name | Identifies the content source. |
| Type | Distinguishes local folders, Feishu documents, and Feishu wikis. |
| Change count | Shows the number of pending reviewable content changes. |
| Latest successful check | Provides freshness without exposing a full scan log. |
| Status | Communicates `Needs review`, `No changes`, or `Status unknown`. |
| Action | Opens the source-filtered Changes page, or Sources for an unknown state. |

### Aggregate Signal

The top signal is derived from source rows:

- `Needs review`: one or more sources contain pending changes. It names the
  source count and total pending change count, and offers `View changes`.
- `No changes`: all successfully checked sources have no pending changes. It
  names the latest successful global check and retains `Check all`.
- `Status unknown`: no source has pending changes, but one or more latest
  checks failed. It never implies that the affected source has no changes.
- `Checking`: preserve the previous list while the global command runs; prevent
  duplicate checks and announce progress.

## Information Architecture

```text
Authenticated application shell
|
|-- Sidebar
|   |-- Dashboard
|   |-- History
|   |-- Sources
|   |-- Settings
|   `-- Account
|
`-- Workbench
    `-- Dashboard
        |-- Page header: Dashboard + Check all
        |-- Aggregate change signal
        |-- Operational facts
        `-- Source status list
            |-- Source with changes -> Changes, filtered to source
            |-- Source with no changes -> Changes, filtered to source
            `-- Source with unknown status -> Sources
```

## Confirmed Wireframe

The Dashboard lives inside the existing rounded right workbench. The outer
application shell, persistent sidebar, type scale, and neutral visual tokens
remain unchanged.

```text
+--------------------+-------------------------------------------------------+
| easyBlog           | Dashboard                            [Check all]      |
|                    |-------------------------------------------------------|
| [*] Dashboard      | +---------------------------------------------------+ |
| [ ] History        | |  3 sources have changes to review                 | |
| [ ] Sources        | |  12 content changes from the latest check         | |
|                    | |                                  [View changes]   | |
|                    | +---------------------------------------------------+ |
|                    |                                                       |
|                    | Sources checked       Pending changes    Last check  |
|                    | 6 / 6                 12                 Today 10:42 |
|                    |-------------------------------------------------------|
|                    | Source              Changes  Status         Action   |
|                    |-------------------------------------------------------|
|                    | Product Notes       7        Needs review   Open     |
|                    | Local folder                                               |
|                    |-------------------------------------------------------|
|                    | Engineering Wiki    5        Needs review   Open     |
|                    | Feishu Wiki                                                |
|                    |-------------------------------------------------------|
|                    | Archive             0        No changes     Open     |
|                    | Local folder                                               |
|                    |-------------------------------------------------------|
|                    | Team Handbook       --       Status unknown Sources  |
|                    | Feishu Document                                            |
+--------------------+-------------------------------------------------------+
```

### Layout Rules

- Keep the existing desktop workbench composition: neutral canvas, white
  workbench, fine borders, compact spacing, and no stacked floating cards.
- The aggregate signal is one restrained bordered callout, not a marketing
  hero. A left semantic status border distinguishes it from normal content.
- Operational facts use a three-column, bordered row. They are supporting
  context, not clickable metrics.
- The source overview is a table-like list with stable columns. Long source
  names wrap or truncate safely without moving status or action positions.
- Sources needing review sort first, followed by sources with an unknown
  status, then sources with no changes. The source count in the signal remains
  the source of truth for aggregate work.
- Use text plus semantic color for state. Color alone must not distinguish
  ready, clear, or unknown states.

## Interaction Rules

| Element | Behavior |
| --- | --- |
| `Check all` | Starts a scan across all configured sources. Disable only once the request begins; retain the current source list while checking. |
| Aggregate `View changes` | Opens `Changes` with all reviewable pending changes in scope. |
| `Open` for a reviewable source | Opens `Changes` with that source as the active filter. |
| `Open` for a no-change source | Opens `Changes` with the source as the active filter; the resulting empty state retains the scan context. |
| `Sources` for an unknown source | Opens the corresponding source in `Sources`; Dashboard does not provide error recovery. |
| Sidebar navigation | Retains the app-shell behavior already established by the current implementation. |

## States

- **First configured source absent:** replace the source list with a concise
  empty state and a route to `Sources`.
- **Checking:** retain the last known state with progress text; prevent a
  duplicate global check.
- **No changes:** replace the aggregate callout with a quiet success statement
  and keep the list of all sources.
- **Partial failure:** show all successful source rows, plus unknown rows for
  failed checks. Do not report a global clean state.
- **Global load failure:** preserve the app shell and show a page-local retry
  state.

## Accessibility and Interface Guideline Criteria

The visual design must meet these criteria at implementation time:

- Render the source overview with semantic table or list markup appropriate to
  the final responsive behavior; do not create clickable `div` rows.
- Use labeled buttons for `Check all`, `View changes`, and source routing.
  Icon-only shell controls retain accessible names and tooltips.
- Announce scan lifecycle updates through a polite live region.
- Preserve visible `:focus-visible` treatment and ensure sticky or fixed
  controls cannot cover a focused item.
- Communicate source status with a visible text label as well as color.
- Keep each row's source name resilient to long, user-provided values using
  wrapping or truncation and `min-width: 0` in flex/grid children.
- Maintain a desktop-first responsive layout: at narrower desktop widths,
  metadata can stack beneath the source name while actions retain stable
  placement. No viewport-scaled typography.
- Use `Intl.DateTimeFormat` for check timestamps and use tabular figures for
  numeric columns.

This is a design validation checklist, not a line-level code audit. The
Web Interface Guidelines should be run against the implementation once the
Dashboard markup and styles exist.

## Deliberate Exclusions

- Publishing actions, release preview, batch selection, and content diff.
- Publication history and rollback.
- Source configuration and source-specific scan commands.
- Usage analytics, article totals, trend charts, and decorative dashboard
  widgets.
- Full diagnostics and recovery workflows.

## Next Visual Design Decisions

The wireframe is confirmed. The following decisions are intentionally open for
the visual design pass:

1. Signal callout treatment: neutral, blue-gray informational, or semantic
   amber when review is pending.
2. Status language and badge treatment for reviewable, clear, and unknown
   sources.
3. Density: row heights, whitespace, and the exact compact-table rhythm.
4. Icon usage for source types and source-row actions.
5. Empty, checking, no-change, and partial-failure visual states.
