# Frontend Experience Redesign Design

**Status:** Proposed for review
**Date:** 2026-09-04
**Scope:** Desktop frontend experience only

## Goal

Redesign easyBlog as a calm, focused desktop utility for reviewing and publishing blog changes. The application must make the next meaningful action obvious, keep routine information scannable, and reserve focused space for work that requires attention.

The current frontend concentrates too many decisions in individual views and chains list pages, side panels, and additional controls together. This redesign replaces that pattern with:

- a task-first workbench;
- a distinct change-list and focused-review workflow;
- source and target resource overviews that lead into dedicated editors;
- lightweight, contextual status and recovery states; and
- a restrained visual system inspired by mature utility applications and shadcn-style component composition.

The result should feel like a dependable publishing tool, not a dashboard, landing page, or collection of decorative cards.

## Scope and Non-Goals

### In Scope

- New desktop information architecture: `工作台 / 变更 / 来源 / 历史`.
- Shared application shell, top status area, navigation, visual tokens, and interaction primitives.
- Workbench, change list, focused change review, release confirmation dialog, source/target list and overview, focused editor, and history list interactions.
- Contextual loading, empty, error, blocked, destructive confirmation, and success states.
- Frontend state ownership and tests required to support these flows.

### Out of Scope

- Changing backend business rules, bridge method names, or release, scan, source, target, and history contracts.
- Changing publication ledger, target ownership, rollback semantics, or Git integration behavior.
- Adding a component framework, React, shadcn/ui, a command palette, theme switching, onboarding, mobile layouts, or a new persistence system.
- Redesigning content rendering rules, source adapters, or authentication flow beyond relocating their existing status and entry points.

The frontend may introduce small local view models and rendering helpers, but it must keep calling the existing bridge APIs. Any contract mismatch discovered during implementation is a separate, narrowly scoped decision.

## Superseded Decisions

This design supersedes the following parts of `docs/decisions/frontend-design.md`:

- The navigation order and entries. The new shell has `工作台 / 变更 / 来源 / 历史`; `发布` is a state within change review, and settings are not a first-level destination.
- Opening a change in a fixed right-side preview panel. Change review is now a focused page.
- Keeping a persistent bottom publish bar as the primary release interaction. Selection remains visible in the change list, while release preview and confirmation occur in focused stages.
- Treating the source directory tree and target configuration as a combined source-page workspace. Source and target summaries are list resources, with editing moved to a dedicated page.
- First-version command palette, theme, and onboarding commitments. They are deliberately deferred until the core flows are stable.

All other applicable product constraints continue to apply.

## Experience Principles

### One Page, One Primary Job

Each major page has a primary task:

- `工作台`: understand what needs attention and begin the next action.
- `变更`: find, filter, select, and inspect pending changes.
- `变更评审`: review the selected content and prepare one publication.
- `来源`: locate a source or target and understand its current state.
- `来源编辑`: make configuration changes safely.
- `历史`: inspect completed or interrupted publication records.

Pages must not also become hidden configuration centers or contain stacked secondary panels.

### List, Then Focus

Lists support scanning and selection. A selected item that needs meaningful inspection or editing opens a dedicated focused page. This avoids the current nested interaction in which a list opens a drawer that opens another configuration surface.

### Progressive Disclosure

The default surface shows only information needed for the current decision. Technical detail, advanced rules, diagnostics, destructive operations, and infrequent actions remain available through disclosed sections or overflow menus.

### Stable Context

Selection, active scope, filter choices, and the review sequence survive navigation between the change list and focused review. Returning from review restores the user to the same list context instead of resetting them to a generic workbench.

### Explicit Irreversibility

Publishing, rollback, and destructive deletion require a clear confirmation dialog. Navigation, ordinary selection, and opening an editor do not use dialogs.

### Quiet Visual Hierarchy

Typography, spacing, borders, and alignment create hierarchy before color does. Status color carries semantic meaning only. Green is reserved for successful, ready, or published states and is not used as the application’s dominant brand color.

## Information Architecture

### Shared Shell

The desktop shell contains:

- A compact left navigation rail with the product mark and the four primary destinations.
- A top bar for page context and GitHub connection state.
- A single main content area. Full-page review and editor routes replace, rather than overlay, their parent page.
- A global dialog layer used only for destructive confirmations and final publication confirmation.

GitHub status moves from the navigation footer to the top bar. It shows a small semantic indicator and concise text such as connected account, connection needed, or status unavailable. The connection action is available in-place without competing with main navigation.

### Page Map

```text
工作台
  -> 检查变更
  -> 变更
      -> 变更评审
          -> 发布确认对话框
          -> 返回变更

来源
  -> 来源概览
      -> 来源编辑
  -> GitHub 目标概览
      -> 目标编辑

历史
  -> 发布记录详情
      -> 回滚确认对话框
```

`来源概览` and `GitHub 目标概览` are contextual views within the source resource route; they do not use a drawer. `变更评审` and editors own their own focused route state.

## Route and State Model

The application currently uses imperative TypeScript DOM rendering rather than a router. This redesign retains that approach and introduces an explicit app view state in the bootstrap layer.

```text
AppView =
  | { page: "workbench" }
  | { page: "changes"; scopeId?: ScopeId }
  | {
      page: "review";
      scopeId: ScopeId;
      selectedChangeIds: string[];
      activeChangeId: string;
    }
  | { page: "sources"; resource?: SourceOrTargetResource }
  | { page: "source-editor"; sourceId: SourceId }
  | { page: "target-editor"; targetId: TargetId }
  | { page: "history" }
  | { page: "history-detail"; publicationId: string };
```

`selectedChangeIds` and `activeChangeId` are view state, not a mutation of backend records. They are kept by the changes controller and passed to review. When review returns to the list, the controller restores the same scope and selection. A scan refresh reconciles the selection by retaining only IDs still present and selectable.

The implementation may use browser history where practical, but browser history is not required to meet this design. Back buttons inside focused views are required and must return to the parent context without losing unsaved editor state silently.

## Workbench

The workbench is the default page and answers: “What should I do next?”

### Content

The page includes:

- One concise primary status describing the next action, such as pending changes, no configured source, disconnected GitHub, or no new changes.
- A prominent primary action: `检查变更`.
- A small set of supporting facts: pending review count, latest scan state/time, and publication readiness.
- One compact recent activity or latest publication summary when available.

### Behavior

- `检查变更` starts a scan for the most relevant active scope, then updates the current-page status. It may offer a direct transition to `变更` when results exist.
- If configuration prevents scanning or publishing, the primary action directs to the appropriate source/target resource rather than exposing configuration controls on the workbench.
- The workbench does not show a complete change list, source tree, target configuration, diff, or release controls.

### Empty and Recovery States

- No active source: explain that a source is needed and offer `添加来源`.
- No GitHub connection: show connection state and `连接 GitHub`.
- No changes: show the last scan time and retain `检查变更`.
- Scan failure: show what failed in brief, preserve the rest of the page, and offer `重试`.

## Changes

The changes page is a list-first selection surface. Its job is to organize pending work, not to publish it directly.

### Layout

- Header: page title, active scope selector, scan state, and `检查变更`.
- Filter and summary row: pending count plus compact filter controls for type and availability where needed.
- Grouped change list: `需要处理 / 新增 / 更新 / 移动 / 删除`.
- Each row: selection control, title, source location, change type, concise state explanation, and a clear row affordance to open review.
- Selection action area: visible only when there is a selection. It shows the selected count and one primary command, `进入评审`.

Selection controls remain checkboxes because change selection is multi-select. Blocked changes stay visible but disabled and are not included in selection. Deleted changes are visibly distinct and opt-in; they are never automatically selected.

### Selection Rules

- New, updated, and moved changes may retain current backend-provided default selection.
- Deleted changes begin unselected, even if the backend marks them selected.
- Blocked changes cannot be selected.
- “Select all eligible” affects only non-blocked, non-deleted changes unless the user explicitly chooses a deletion-inclusive action.
- Rescanning retains selection only for still-existing selectable IDs.

### Open Review

Clicking a row’s review affordance opens `变更评审`. When no items are selected, opening a row begins a temporary selection containing that row. When items are selected, it opens the selected batch and uses the clicked row as the active item.

The page must not open a right drawer, fixed release panel, or nested configuration panel.

### Current-Page States

- Loading: skeleton or concise loading state in the list region.
- No scope: explain the prerequisite and offer navigation to `来源`.
- Empty: show last scan state and `检查变更`.
- List error: show an actionable retry state in the page body.
- Scan in progress: keep existing list context visible where possible, disable duplicate scan action, and announce progress.

## Focused Change Review

The focused review page is where users inspect a selected set before publication.

### Layout

- Top bar: `返回变更`, selected count, current position in the batch, and clear review context.
- Narrow left sequence list on wide desktop: selected items only, ordered consistently with the list page. The active item is visually distinct. It can collapse on narrower desktop widths, while next/previous controls remain available.
- Main review area: item title, source path, state summary, and content views.
- Content views use tabs or a segmented control for `摘要 / Markdown / Diff`; only one heavy content representation is shown at a time.
- Footer or top action region: `上一个`, `下一个`, and `预览发布`.

The review page is intentionally a working page, not a modal and not a side panel.

### Release Preview

`预览发布` calls the existing preview bridge with the focused review’s frozen scope and selected IDs. It keeps the user in the review page and changes the main region to a release-preview summary:

- Target repository and branch.
- Number of selected changes and affected target files.
- A file list with paths, operation kinds, and diffs.
- A visible distinction between preview-generation failure and target/configuration blockage.
- `返回评审` and `确认发布` actions.

Generating a preview is not a confirmation dialog. It is a review state because it can contain meaningful file-level information.

### Final Publish Confirmation

Selecting `确认发布` opens a modal dialog. The dialog contains only the final facts needed to authorize the irreversible action:

- Target repository and branch.
- Number of source changes and target files.
- The persisted preview/batch identifier or equivalent concise publication reference when useful.
- A direct statement that the exact previewed batch will be committed and pushed.
- `取消` and `确认发布`.

The dialog must call `publishRelease({ batch_id })`, never reconstruct a new release from the current list selection. While publishing, it disables dismissal paths that could cause duplicate commands and provides a clear progress label.

On success, the dialog closes, the review page presents a compact published result with commit identifier, and `返回变更` refreshes the originating list. The selection is cleared only after a confirmed successful publication.

On error, the review page remains available. It renders the error in context with an appropriate recovery action: retrying preview, changing configuration, or returning to changes. It does not discard the selection automatically.

## Sources and Targets

Sources and GitHub targets are presented as resources, not as an all-in-one configuration screen.

### Resource List

The source page has a unified resource list or clearly segmented resource categories:

- Content sources: name, type, status, last scan or relevant activity.
- GitHub targets: repository, branch, connection state, and binding/use state.

The page’s header contains add actions appropriate to the current category. Low-frequency actions, removal, and other destructive actions reside in an overflow menu.

### Lightweight Overview

Selecting a resource updates the main content to a concise overview in the same page:

- identity and current status;
- the most relevant activity and relationship summary;
- small, read-only scope/binding summary;
- a clear `编辑` command;
- a `更多` menu for infrequent or destructive actions.

The overview must not contain a full editable form, a permanently expanded path tree, target configuration controls, or an advanced rules editor.

### Dedicated Source Editor

`编辑` opens a focused source editor page with:

- persistent `返回来源` navigation;
- an edit title and source identity;
- the editable configuration fields for that source;
- scope/path configuration in a clear, contained section;
- advanced rules hidden in a collapsed disclosure by default;
- `取消` and `保存` actions at a stable location.

`取消` returns to the previous resource overview without saving. If local changes are unsaved, the application asks before discarding them. `保存` remains disabled or reports field-level validation until required input is valid. A successful save returns to the source overview with refreshed status.

### Dedicated Target Editor

The target editor follows the same boundary and controls:

- repository and branch configuration;
- scope binding and target layout fields;
- advanced configuration on demand;
- stable `取消` and `保存`;
- destructive unlink/remove actions in `更多`, each with confirmation.

Saving target settings does not imply publishing or changing remote files. The frontend describes any backend-reported required reconciliation as a separate next action.

### Error and Empty States

- Resource loading failure: current-page retry state.
- No sources: concise empty state with `添加来源`.
- No targets: concise empty state with `连接 GitHub` or `添加目标`.
- Missing or inaccessible selected resource: explain that it is unavailable and provide return navigation.
- Editor save failure: preserve entered values, show field-level errors where known, otherwise a clear page-level retry state.

## History

History remains a highly scannable publication list.

### Layout and Actions

Each row presents date/time, target, result state, commit identifier where available, and concise affected-item information. Selecting a row can open a detail view or inline expanded detail only when it does not make the list hard to scan.

Rollback is an overflow-menu action for an eligible published record. It is never visually equal to the normal publish flow.

### Rollback Confirmation

The confirmation dialog names the publication, target, and affected content count, states that rollback creates a new reverse commit, and offers `取消` and `确认回滚`. It exposes structured backend reasons when rollback is unavailable. Records that are legacy, recovery-required, or otherwise unavailable must show the reason and no enabled rollback command.

## Visual System

The visual language uses a restrained token system. It should be implementable in the existing CSS rather than requiring a design-library migration.

### Color Roles

- Canvas and panel surfaces: warm white and subtle neutral gray.
- Primary text: graphite/near-black.
- Secondary text and border: neutral grays with accessible contrast.
- Interactive accent and selected states: blue-gray.
- Success, ready, and published: green only.
- Warning: amber.
- Error, destructive, and blocked: red.
- Diff additions and removals: conventional, accessible green/red treatment with non-color labels and text differences.

Avoid green-dominant branding, large gradients, decorative background shapes, excessive shadows, and visual effects that do not improve task comprehension.

### Typography and Spacing

- Use a practical system sans-serif stack.
- Use compact, stable desktop type scales; headings identify task context rather than imitate marketing heroes.
- Keep letter spacing at `0`.
- Use a small spacing scale consistently, with ample separation between actions and dense but readable rows.
- Prefer simple flat surfaces with fine borders. Repeated items may use small-radius cards or rows; page sections are not floating card stacks.

### Controls

- Use semantic buttons for clear commands and recognizable icons for compact utility actions, with tooltips and accessible names.
- Use checkboxes for multi-selection, select menus for scopes and option sets, tabs/segmented controls for mutually exclusive review views, and overflow menus for low-frequency actions.
- Use 8px or smaller corner radii unless a native control requires otherwise.
- Define stable dimensions for toolbar controls, row metadata, status badges, icon buttons, and review panes to prevent layout shift.

### Responsive Desktop Behavior

The primary target is desktop. Content must remain usable in narrower desktop windows:

- Navigation can condense to icon-plus-tooltip or a compact rail only after retaining an accessible current-page indication.
- The review sequence may collapse while previous/next navigation remains available.
- Tables and rows should reflow metadata rather than truncate critical titles or overlap controls.
- No viewport-width font scaling.

## Accessibility and Interaction Quality

- Use semantic landmarks, headings, labels, native controls, and clear focus indicators.
- Keep keyboard focus inside confirmation dialogs and return it to the invoking control when a dialog closes.
- Announce scan, preview, publish, save, and rollback progress/results with appropriate live regions.
- Do not encode readiness, blocked state, or diff direction by color alone.
- Preserve a logical tab order; focused pages begin with their back navigation and heading.
- Disable controls only when an action is genuinely unavailable, and pair disabled states with concise explanatory text where needed.
- Prevent accidental double-submit during all asynchronous mutations.

## Component and Module Ownership

The implementation should reorganize the current feature modules around page responsibilities while retaining the existing bridge layer.

```text
src/app/
  bootstrap.ts                Application shell, top bar, navigation, view state
  view-state.ts               Optional explicit AppView transitions and helpers

src/features/workbench/
  index.ts                    Workbench rendering and scan entry

src/features/changes/
  index.ts                    Change list, selection state, scan behavior
  review.ts                   Focused review and preview/publish flow

src/features/sources/
  index.ts                    Resource list and overview
  editor.ts                   Focused source/target editor views and save/cancel behavior

src/features/history/
  index.ts                    History list, detail, rollback entry

src/styles/
  tokens.css                  Shared color, spacing, typography, and control tokens
  app.css                     Shell and shared primitives
  changes.css                 Change list and review
  sources.css                 Resources and editors
  history.css                 History states
```

Exact file splitting may remain more compact if the existing codebase is small, but ownership must remain clear: list selection code must not own review DOM, and source overview code must not own full editor state.

The existing `src/styles.css` may be incrementally decomposed. A wholesale CSS rewrite is not required if it would obscure behavior changes.

## Bridge Contract Boundary

The frontend continues to use existing bridge functions for:

- listing scopes, changes, sources, targets, and history;
- scanning;
- previewing and publishing a release;
- saving source and target configuration;
- GitHub connection status/login; and
- rollback.

The only publication command allowed after a successful preview is the existing `publishRelease({ batch_id })`. The UI must never publish by rebuilding a list of IDs after preview.

No new backend persistence is required for UI-only navigation and selection state. Any later request for persistent routes, deep links, or stored UI preferences is deferred.

## Testing Strategy

### Unit and Render Tests

- App shell renders all four primary navigation destinations and top-bar GitHub status.
- Workbench renders correct next-action, empty, connection-needed, scan-error, and ready summaries.
- Change list groups items, keeps blocked items visible/unselectable, and keeps deleted items opt-in.
- Selected IDs persist through change list to review and back; scans reconcile invalid IDs without losing remaining valid selections.
- A clicked review row opens the intended active item and respects an existing selection.
- Review view switches summary, Markdown, and diff without rendering all heavy panels simultaneously.
- Preview uses the focused scope and selected IDs; publish uses only the returned `batch_id`.
- Preview, publish, scan, save, and rollback failures render distinct recovery actions.
- Source/target overview never renders editing controls; dedicated editor has stable back, cancel, and save actions.
- Cancel preserves server values; failed save preserves unsaved form values.
- History places rollback in overflow behavior and disables or explains unavailable rollback.

### Interaction and Visual Verification

- Exercise the primary desktop workflow: workbench -> scan -> select -> review -> preview -> confirmation -> published result -> refreshed change list.
- Exercise source configuration: sources -> overview -> editor -> cancel; then editor -> save -> refreshed overview.
- Exercise target configuration and an unavailable/blocked resource.
- Verify a destructive confirmation and a rollback confirmation keep focus and do not cause duplicate action calls.
- Capture desktop screenshots for workbench, populated changes, focused review, resource overview, focused editor, history, and representative loading/error/empty states.
- Check screenshots at wide and narrow desktop widths for clipped text, overlapping controls, unstable dimensions, and excess card/drawer density.

## Acceptance Criteria

The redesign is complete when:

- The main navigation is `工作台 / 变更 / 来源 / 历史`, and GitHub status appears in the top bar.
- Workbench communicates the next action without duplicating configuration or a complete change list.
- Users select changes in a list and inspect them in a dedicated focused review page, never a fixed right drawer.
- Selection and active review context survive a return from focused review.
- Preview appears as a review state, and final publish occurs only through an explicit confirmation dialog using the persisted preview batch ID.
- Source and target pages provide lightweight resource overviews; all meaningful configuration opens a dedicated editor page with back, cancel, and save.
- Advanced rules and destructive actions are not part of the default resource overview.
- Blocked changes remain visible and unavailable; deleted changes are opt-in.
- Loading, empty, error, and recovery states remain contextual and actionable.
- Rollback is a secondary history action with a confirmation dialog.
- The frontend uses a calm neutral desktop visual system with blue-gray interaction states and semantic status colors, rather than a green-dominant or card-heavy aesthetic.
- Existing bridge contracts remain unchanged unless a separately approved implementation decision is needed.
- Focused tests and desktop visual verification cover the primary flows and failure states described above.

## Deferred Decisions

The following may be evaluated after this redesign is implemented and observed in use:

- Command palette and keyboard shortcut map.
- Light/dark theme support and persisted theme preference.
- First-run onboarding sequence.
- Browser history/deep-link routing.
- Mobile or touch-first layouts.
- User-customizable dashboard modules or list columns.
