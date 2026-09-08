# Sources Library Design

**Status:** Awaiting final design review
**Date:** 2026-09-08
**Scope:** Desktop Sources landing page only

## Goal

Reshape Sources into a focused source-management library. An author should be
able to locate a content source, understand whether its configured sync ranges
are usable, and reach the appropriate configuration flow without having
content sources and GitHub targets compete in the same primary list.

This design preserves the existing source editor, target editor, persistence,
and bridge contracts. It changes only the Sources landing-page hierarchy,
markup, interaction presentation, styles, and related frontend tests.

## User Job

When an author opens Sources, they need to answer:

> Which content source do I need to configure, and which of its sync ranges
> can publish where?

Sources is a configuration and routing surface. It is not a scan-status
dashboard, an activity log, a content browser, or a publishing workspace.

## Confirmed Direction

- The primary object is a content source.
- The page uses a stable master-detail layout: the left pane locates an object;
  the right pane explains it and routes to configuration.
- GitHub targets remain manageable from Sources, but they appear through a
  top-level `发布目标` tab rather than being mixed with content sources in one
  resource list.
- The selected source detail shows its sync ranges and the target bound to each
  range. A target is relationship context, not a peer competing for attention.
- `新建同步范围` and `编辑` continue to open the existing focused editors.
- The landing page never claims source freshness, scan history, or recent
  activity because the current Sources contracts do not supply truthful data
  for those fields.
- The page retains the current app shell, desktop workbench, visual tokens,
  primary button treatment, and Chinese product copy.

## Information Architecture

```text
Authenticated application shell
|
`-- Sources
    |-- Header: 内容来源 + 添加内容来源 + 连接 GitHub 目标
    |-- Object-type tabs
    |   |-- 内容来源
    |   `-- 发布目标
    `-- Master-detail work area
        |-- Object list
        |   |-- selected source or target
        |   `-- compact type, scope/binding count, and visible health/state
        `-- Selected object detail
            |-- name, path/repository, and overflow context
            |-- concise facts
            `-- related configuration rows
                |-- source: sync ranges and each bound target
                `-- target: publishing adapter and bound-range count
```

## Source List and Detail

### Source List

The default tab is `内容来源`.

Each row renders:

| Field | Purpose |
| --- | --- |
| Source name | Identifies the source. |
| Type | Shows `本地目录` in this release; keeps the row model ready for later source types. |
| Scope count | Gives configuration coverage without turning the list into a dashboard. |
| State label | Summarizes scope usability as `可用`, `待绑定目标`, `已阻塞`, `已暂停`, or `未配置`. |
| Path | Secondary, truncated monospaced context. |

Rows are native buttons. A selected row has the existing restrained selected
treatment using `--accent-soft`; it does not introduce a new color system.
Long source names and paths must safely truncate or wrap within their grid
cell without moving the state label.

### Source Detail

The detail header renders:

- `内容来源` eyebrow;
- source name;
- canonical local path;
- an explicit `新建同步范围` primary action;
- an overflow disclosure whose copy directs lower-frequency management to the
  focused editor.

The fact row renders exactly:

- source type;
- sync-range count.

The related configuration section is titled `范围与绑定`.

Each scope row renders:

- scope name;
- visible health/lifecycle label;
- target relationship: `已绑定发布目标` or `未绑定发布目标`;
- `编辑` action opening the existing source editor at that scope.

When a source has no ranges, a concise empty message remains in this section
and the primary `新建同步范围` action stays available.

The source detail does not render scan timestamps, activity, content counts,
or a separate source-edit form.

## Target Tab and Detail

The `发布目标` tab replaces the source list with connected GitHub targets while
retaining the same detail pane and page header. Switching tabs selects the
first object in that category when the previously selected object is not in
the tab; it never leaves a stale source detail beside a target list.

Each target row renders:

- repository name;
- visibility and default branch;
- bound active-range count;
- a visible state label: `可用`, `待配置`, `需要重新连接`, or `需要修复`.

The target detail renders:

- `GitHub 目标` eyebrow;
- repository, default branch, and visibility;
- state and bound-range count;
- publishing configuration summary;
- `编辑` action opening the existing target editor.

Targets do not gain in-place configuration controls. The target editor remains
the owner of adapter, directory, preview-initialization, and confirmation
flows.

## Actions and State

| User action | Result |
| --- | --- |
| `添加内容来源` | Opens the existing inline source-add panel. |
| `连接 GitHub 目标` | Opens the existing inline repository-connection panel and preserves repository-refresh behavior. |
| Select a list row | Re-renders its corresponding detail in the right pane. |
| Select `内容来源` or `发布目标` | Changes the list category and selects a valid row from it. |
| `新建同步范围` | Opens the existing focused source editor for the selected source. |
| Scope `编辑` | Opens the focused source editor for the selected source and scope. |
| Target `编辑` | Opens the focused target editor. |
| Landing-page retry | Repeats the current resource load using the existing request-generation guard. |

Loading, page-level error, and no-resource states remain page-local and retain
the existing `内容来源` heading. The empty state presents both primary setup
paths: add a content source and connect a GitHub target. It does not imply
that both are required before the user can take the first action.

## Visual Integration

The current application style is authoritative:

- Keep the existing `app-shell` sidebar and rounded `app-workbench`.
- Use the existing neutral tokens: `--canvas`, `--surface`, `--surface-muted`,
  `--border`, `--border-strong`, `--text`, `--muted`, and `--accent`.
- Keep `--accent` black for primary commands. Do not import the mockup's green
  button, dark sidebar, or a new palette.
- Reuse the existing 7px control radius, 10px workbench radius, compact
  typography, fine dividers, and no-card page structure.
- Use Lucide icons only where the app already supplies them. Existing text
  buttons remain text buttons when their command needs visible wording.
- Maintain a two-column desktop work area. At narrower desktop widths, switch
  to the existing stacked behavior; do not invent a mobile navigation pattern.

## Accessibility

- Use a native tablist or a clearly labelled group of native tab buttons with
  visible selected state and keyboard-accessible controls.
- Use a labelled navigation/list landmark for the object list and an
  independently labelled detail region.
- Each list row is one native button; nested controls are prohibited.
- State is communicated with visible Chinese text, not color alone.
- Primary and secondary actions use descriptive labels. Any overflow trigger
  has an accessible name and title.
- Preserve the global visible focus ring.
- Keep live-region behavior for loading and source/target connection messages.
- Ensure all list and detail grid children use `min-width: 0` where needed to
  prevent user-supplied names or paths from overflowing.

## Testing and Verification

- Update Sources render tests for source/target category tabs, selected-row
  detail content, source range rows, target configuration detail, empty,
  loading, and error states.
- Keep mount tests covering inactive async completion, repository refresh
  deduplication, source add, target connection, and focused-editor navigation.
- Add tests that tab changes cannot leave a detail from another object type
  visible.
- Run the focused Sources Vitest suite, the full frontend test suite, and
  `npm run build`.
- Run `git diff --check`.
- Audit the resulting Sources markup and styles against the current Web
  Interface Guidelines, then visually inspect populated, source-empty,
  target-empty, loading, error, long-name, and narrow-desktop states.

## Deliberate Exclusions

- No new source types, scanning data, recent activity, search, filtering,
  sorting, deletion, source renaming, source editing, or bulk management.
- No backend, bridge, contract, storage, or editor-flow changes.
- No target editing inside the Sources landing page.
- No changes to the Dashboard, Changes, Publishing, History, Settings, shell,
  or sidebar navigation.
