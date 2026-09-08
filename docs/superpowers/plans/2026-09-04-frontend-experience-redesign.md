# Frontend Experience Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the easyBlog desktop frontend around a focused workbench, a dedicated change-review workflow, resource overviews with focused editors, and a calm utility-app visual system.

**Architecture:** Keep the existing Vite, TypeScript, imperative DOM-rendering architecture and bridge contracts. Add explicit app view transitions in the bootstrap layer, pass navigation callbacks into feature mounts, and split rendering into focused page modules where the current feature files mix list, editor, and release behavior. Preserve backend APIs; selection and navigation remain transient frontend state.

**Tech Stack:** TypeScript 5, Vite 6, Vitest 3, native browser controls, existing Tauri bridge APIs, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-09-04-frontend-experience-redesign-design.md`

## Global Constraints

- The primary target is the desktop application; do not add a mobile-first layout, a component framework, or a dependency on shadcn/ui.
- Keep the public bridge method names and release/source/target/history payload contracts unchanged.
- `publishRelease` must be called only with the persisted preview `batch_id`; never recreate a publish request from mutable list selection.
- Keep blocked changes visible and unavailable, and make deleted changes opt-in even when the backend has marked them selected.
- Use `工作台 / 变更 / 来源 / 历史` as the first-level navigation. GitHub status belongs in the top bar.
- Details needing substantial inspection or editing open focused views; do not introduce a new fixed right drawer or nested configuration panel.
- Only destructive actions, final publish, and rollback use confirmation dialogs.
- Use warm-neutral surfaces, graphite text, blue-gray interaction states, and semantic success/warning/error colors. Green is success-only, not a dominant theme.
- Keep all user-facing frontend copy in Chinese and use ASCII source text unless existing code requires a non-ASCII character.
- Every task must pass its focused Vitest coverage and `npm run build` before its commit.

---

### Task 1: Application Shell, View State, and Task-First Workbench

**Files:**
- Create: `src/app/view-state.ts`
- Create: `src/app/view-state.test.ts`
- Create: `src/features/workbench/index.ts`
- Create: `src/features/workbench/index.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Produces `AppView`, `createViewState`, and `renderAppShell` for all feature navigation.
- Produces `mountWorkbench(root, api, navigation)` with `refresh(): void`.
- Consumes existing `githubAuthorizationStatus`, `startGithubLogin`, `listScopes`, `listChanges`, `scanScope`, and `listPublications` bridge APIs.
- Provides `navigate(view: AppView): void` to changes, sources, and history feature mounts in later tasks.

- [ ] **Step 1: Write failing view-state tests in `src/app/view-state.test.ts`.**

```ts
import { describe, expect, it } from "vitest";
import { createViewState } from "./view-state";

describe("app view state", () => {
  it("returns from focused review to the originating change selection", () => {
    const state = createViewState({ page: "changes", scopeId: "scope-1" });
    state.openReview("scope-1", ["change-a", "change-b"], "change-b");

    expect(state.current()).toEqual({
      page: "review",
      scopeId: "scope-1",
      selectedChangeIds: ["change-a", "change-b"],
      activeChangeId: "change-b",
    });

    state.backFromReview();
    expect(state.current()).toEqual({
      page: "changes",
      scopeId: "scope-1",
      selectedChangeIds: ["change-a", "change-b"],
    });
  });
});
```

- [ ] **Step 2: Run `npm test -- src/app/view-state.test.ts` and confirm it fails because `createViewState` does not exist.**

- [ ] **Step 3: Implement `src/app/view-state.ts` with explicit discriminated `AppView` values.**

```ts
export type AppView =
  | { page: "workbench" }
  | { page: "changes"; scopeId?: string; selectedChangeIds?: string[] }
  | { page: "review"; scopeId: string; selectedChangeIds: string[]; activeChangeId: string }
  | { page: "sources"; resourceId?: string }
  | { page: "source-editor"; sourceId: string; scopeId?: string }
  | { page: "target-editor"; targetId: string }
  | { page: "history" };

export type ViewState = {
  current: () => AppView;
  navigate: (next: AppView) => void;
  openReview: (scopeId: string, selectedChangeIds: string[], activeChangeId: string) => void;
  backFromReview: () => void;
};
```

`backFromReview` must restore the scope and selected IDs. `navigate` must clone array fields before storing them so callers cannot mutate the saved selection after navigation.

- [ ] **Step 4: Write failing workbench render tests in `src/features/workbench/index.test.ts`.**

```ts
it("renders an actionable pending-review state", () => {
  const html = renderWorkbench({
    status: "ready",
    scopeName: "文章",
    pendingCount: 3,
    scannedAt: "2026-09-04T08:00:00Z",
    publicationState: "ready",
    latestPublication: null,
  });

  expect(html).toContain("3 项待确认变更");
  expect(html).toContain('data-action="scan"');
  expect(html).toContain('data-action="open-changes"');
});

it("renders a configuration recovery action instead of a change list", () => {
  expect(renderWorkbench({ status: "needs_scope" })).toContain('data-action="open-sources"');
});
```

- [ ] **Step 5: Run `npm test -- src/features/workbench/index.test.ts` and confirm it fails because the module does not exist.**

- [ ] **Step 6: Implement `src/features/workbench/index.ts`.**

Define these view-only types:

```ts
export type WorkbenchState =
  | { status: "loading" }
  | { status: "needs_scope" }
  | { status: "needs_target"; scopeName: string }
  | { status: "empty"; scopeName: string; scannedAt?: string; latestPublication: PublicationRecord | null }
  | {
      status: "ready";
      scopeName: string;
      pendingCount: number;
      scannedAt?: string;
      publicationState: "ready" | "needs_target" | "blocked";
      latestPublication: PublicationRecord | null;
    }
  | { status: "error"; message: string };

export type WorkbenchNavigation = {
  openChanges: (scopeId?: string) => void;
  openSources: () => void;
};
```

Load active scopes, their changes, and the newest publication record with `Promise.all`. Select the first active scope, count pending changes, map no target to `needs_target`, and preserve an actionable retry error. The only primary scan action calls the existing `scanScope`; after a scan with changes, render an `open-changes` action rather than embedding a full list.

- [ ] **Step 7: Refactor `src/app/bootstrap.ts` to render the new shell and mount page panels through `AppView`.**

Use this shell shape:

```ts
root.innerHTML = `
  <div class="app-shell">
    <aside class="app-nav" aria-label="主导航">...</aside>
    <section class="app-frame">
      <header class="app-topbar" data-github-authorization></header>
      <main class="app-content" data-app-content></main>
    </section>
  </div>
`;
```

Render all four nav buttons. The top-bar GitHub renderer must keep the existing states (`ready`, `missing_cli`, `unavailable`, unauthenticated) and connection action but must not live inside the nav. Use the view state to mount only the current page; inject navigation callbacks into workbench and later features. Default to `{ page: "workbench" }`.

- [ ] **Step 8: Add the first CSS token layer in `src/styles.css` and restyle only the shell/workbench primitives.**

Add CSS custom properties for canvas, surface, text, muted text, border, focus, accent, success, warning, and danger. Establish:

```css
:root {
  --canvas: #f8f7f4;
  --surface: #ffffff;
  --text: #25282b;
  --muted: #6d737a;
  --border: #e2e3df;
  --accent: #4d6f8f;
  --accent-strong: #365b7a;
  --success: #2f7a57;
}
```

Replace the green navigation theme with a warm-neutral page shell and blue-gray selected navigation state. Add visible `:focus-visible` styling, native-control reset rules, 8px-or-smaller radii, and stable top-bar/nav dimensions. Do not restyle change/source/history feature markup in this task.

- [ ] **Step 9: Run `npm test -- src/app/view-state.test.ts src/features/workbench/index.test.ts`, then `npm run build`; confirm both pass.**

- [ ] **Step 10: Commit Task 1.**

```bash
git add src/app/view-state.ts src/app/view-state.test.ts src/features/workbench/index.ts src/features/workbench/index.test.ts src/app/bootstrap.ts src/styles.css
git commit -m "feat: add focused app shell and workbench"
```

### Task 2: Change List Selection and Focused Review

**Files:**
- Create: `src/features/changes/review.ts`
- Create: `src/features/changes/review.test.ts`
- Modify: `src/features/changes/index.ts`
- Modify: `src/features/changes/index.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `AppView` and `ViewState` from Task 1.
- Consumes `ChangesApi` and existing `previewRelease` / `publishRelease` bridge contracts.
- Produces `mountChanges(root, api, navigation, initialContext)` and `mountChangeReview(root, api, context, navigation)`.
- Produces `reconcileSelectedChangeIds`, `defaultSelectedChanges`, `renderChangeReview`, and `renderPublishDialog`.

- [ ] **Step 1: Write failing selection reconciliation tests in `src/features/changes/index.test.ts`.**

```ts
it("keeps explicit deletion selections after a scan while removing stale and blocked IDs", () => {
  const next = [
    change("added", "keep"),
    change("deleted", "delete"),
    change("blocked", "blocked"),
  ];

  expect(reconcileSelectedChangeIds(new Set(["keep", "delete", "missing", "blocked"]), next))
    .toEqual(new Set(["keep", "delete"]));
  expect(defaultSelectedChanges(next).map((item) => item.id)).toEqual(["keep"]);
});
```

- [ ] **Step 2: Write failing focused-review tests in `src/features/changes/review.test.ts`.**

```ts
it("renders only selected changes and marks the requested item active", () => {
  const html = renderChangeReview(reviewState([change("added", "a"), change("updated", "b")], "b"));

  expect(html).toContain('data-change-id="a"');
  expect(html).toContain('data-change-id="b" aria-current="true"');
  expect(html).not.toContain("未选择的变更");
});

it("renders a final dialog that publishes the persisted batch only", () => {
  const html = renderPublishDialog(plan("batch-1"), target);

  expect(html).toContain('data-action="confirm-publish" data-batch-id="batch-1"');
  expect(html).not.toContain("data-change-id");
});
```

- [ ] **Step 3: Run `npm test -- src/features/changes/index.test.ts src/features/changes/review.test.ts` and confirm the new assertions fail.**

- [ ] **Step 4: Refactor `src/features/changes/index.ts` into a list-only controller.**

Keep `loadChanges`, grouping, scanning, and target lookup. Change the mount signature to:

```ts
export type ChangesNavigation = {
  openReview: (context: {
    scopeId: ScopeId;
    selectedChangeIds: string[];
    activeChangeId: string;
  }) => void;
  openSources: () => void;
};

export function mountChanges(
  root: HTMLElement,
  api: ChangesApi,
  navigation: ChangesNavigation,
  initialContext?: { scopeId?: ScopeId; selectedChangeIds?: string[] },
): ChangesController;
```

Remove `ReleaseState`, `renderReleasePanel`, and drawer-specific actions. Change the row renderer to include an accessible `data-action="open-review"` button. Render a selection action region only when at least one item is selected, labeled `进入评审`. Do not make the selection region fixed to the viewport.

- [ ] **Step 5: Implement `src/features/changes/review.ts` as the focused review state machine.**

Define:

```ts
export type ReviewState =
  | { status: "loading" }
  | { status: "ready"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; activeView: "summary" | "markdown" | "diff" }
  | { status: "previewing"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string }
  | { status: "preview"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; plan: ReleasePlan; target: ConnectedTarget }
  | { status: "publishing"; plan: ReleasePlan; target: ConnectedTarget }
  | { status: "published"; plan: ReleasePlan; publication: Publication }
  | { status: "error"; message: string; recovery: "retry-preview" | "open-sources" | "back-to-changes" };
```

Load the scope’s latest change list and preserve the incoming selection order after filtering missing/blocked IDs. If no selected change remains, render a contextual return-to-list recovery state. Summary shows title, type, source path, and deletion/blocked notes. Markdown and diff tabs initially use the available source/change metadata and the persisted `ReleasePlan.diffs`; no new backend content-reading API is introduced.

`预览发布` calls `previewRelease({ scope_id, change_ids })`. `确认发布` opens a `<dialog data-publish-dialog>` with repository, branch, selected count, affected file count, `取消`, and `确认发布`. The confirm action calls `publishRelease({ batch_id: plan.batch.id })` exactly once. Preserve the review page after a failure and use the error’s recovery type to render `重试预览`, `前往来源`, or `返回变更`.

- [ ] **Step 6: Wire review navigation in `src/app/bootstrap.ts`.**

When `AppView.page === "review"`, mount the review module with callbacks:

```ts
{
  backToChanges: (context) => viewState.navigate({
    page: "changes",
    scopeId: context.scopeId,
    selectedChangeIds: context.selectedChangeIds,
  }),
  openSources: () => viewState.navigate({ page: "sources" }),
}
```

The changes feature’s `openReview` callback must call `viewState.openReview`. The UI must remount the list context from the saved selection when the user returns.

- [ ] **Step 7: Add changes/review CSS in `src/styles.css`.**

Replace the existing fixed `.selection-bar` and `.release-panel` rules. Use a full-width review layout with a compact sequence column, one active content pane, non-fixed selection action region, and `dialog` backdrop. Use tabs or a segmented control with one active content view. Define responsive desktop grid rules that collapse the sequence rail before reducing content legibility.

- [ ] **Step 8: Run `npm test -- src/features/changes/index.test.ts src/features/changes/review.test.ts`, then `npm run build`; confirm both pass.**

- [ ] **Step 9: Commit Task 2.**

```bash
git add src/features/changes/index.ts src/features/changes/index.test.ts src/features/changes/review.ts src/features/changes/review.test.ts src/app/bootstrap.ts src/styles.css
git commit -m "feat: add focused change review workflow"
```

### Task 3: Source and Target Resource Overviews with Focused Editors

**Files:**
- Create: `src/features/sources/editor.ts`
- Create: `src/features/sources/editor.test.ts`
- Modify: `src/features/sources/index.ts`
- Modify: `src/features/sources/index.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `AppView` from Task 1 and existing `SourcesApi` methods.
- Produces `mountSources(root, api, navigation, initialResourceId?)` for resource list/overview only.
- Produces `mountSourceEditor(root, api, sourceId, scopeId?, navigation)` and `mountTargetEditor(root, api, targetId, navigation)`.
- Keeps `saveScope`, `setScopeLifecycle`, `inspectTargetConfiguration`, `saveTargetConfiguration`, `previewTargetInitialization`, and `initializeTarget` payloads unchanged.

- [ ] **Step 1: Write failing resource-overview tests in `src/features/sources/index.test.ts`.**

```ts
it("renders source and target resources without embedding an editor form", () => {
  const html = renderResourceOverview({
    kind: "source",
    source,
    scopes: [summary],
  });

  expect(html).toContain('data-action="edit-source"');
  expect(html).not.toContain('id="scope-form"');
  expect(html).not.toContain('name="posts-directory"');
});

it("renders an actionable target-empty state", () => {
  expect(renderResources({ status: "ready", sources: [source], targets: [] }))
    .toContain('data-action="connect-target"');
});
```

- [ ] **Step 2: Write failing focused-editor tests in `src/features/sources/editor.test.ts`.**

```ts
it("keeps advanced rules collapsed by default and exposes stable save/cancel commands", () => {
  const html = renderSourceEditor(editorState);

  expect(html).toContain('data-action="back-to-sources"');
  expect(html).toContain('data-action="cancel-edit"');
  expect(html).toContain('type="submit"');
  expect(html).toContain("<details");
  expect(html).not.toContain("open");
});

it("preserves entered target configuration after a save error", () => {
  const next = targetEditorSaveFailed(initialTargetEditorState, "目录不可用");
  expect(next.form.postsDirectory).toBe("content/posts");
  expect(next.error).toBe("目录不可用");
});
```

- [ ] **Step 3: Run `npm test -- src/features/sources/index.test.ts src/features/sources/editor.test.ts` and confirm the new tests fail.**

- [ ] **Step 4: Refactor `src/features/sources/index.ts` to own only resource list and lightweight overview state.**

Create a resource union:

```ts
export type SourceResource =
  | { kind: "source"; id: string; source: Source; scopes: ScopeSummary[] }
  | { kind: "target"; id: string; target: ConnectedTarget; boundScopeCount: number };
```

Load sources, scopes, and targets together. Render `内容来源` and `GitHub 目标` resource sections with status and concise secondary metadata. Selecting a resource renders only identity, status, binding/scope summary, `编辑`, and overflow actions. Move add source and target connection into a short current-page action section; do not render scope tree, rule fields, target layout inputs, or initialization preview inside the overview.

- [ ] **Step 5: Implement `src/features/sources/editor.ts` with separate focused editor mounts.**

Source editor state owns the selected source, optional scope, selections, tree children, include/exclude rules, dirty state, saving state, and recoverable error. Target editor state owns selected target, layout candidates, initialized form values, initialization preview, dirty state, saving state, and recoverable error.

Use the following navigation type:

```ts
export type EditorNavigation = {
  backToSources: (resourceId?: string) => void;
};
```

Source save calls the existing `saveScope` payload, then invokes `backToSources(source.id)`. Target save calls existing `saveTargetConfiguration`, optionally displays initialization confirmation in the same focused page if the backend reports it is needed, and invokes `backToSources(target.id)` only after the target is ready or the user explicitly returns. `取消` returns without saving; when dirty, use a native confirmation dialog before discarding. Scope pause/delete and target initialization remain overflow/destructive actions with explicit confirmation, never peer save buttons.

- [ ] **Step 6: Update `src/app/bootstrap.ts` source-route handling.**

Map `sources` to `mountSources`, `source-editor` to `mountSourceEditor`, and `target-editor` to `mountTargetEditor`. Source overview `编辑` must call:

```ts
viewState.navigate({ page: "source-editor", sourceId, scopeId });
```

Target overview `编辑` must call:

```ts
viewState.navigate({ page: "target-editor", targetId });
```

All returns must reopen `sources` with the selected resource ID.

- [ ] **Step 7: Add sources/editor CSS in `src/styles.css`.**

Remove the `.scope-workspace`, inline `.scope-editor`, and inline `.target-configuration` presentation rules after replacing their markup. Use a full-page resource layout with list navigation and a concise overview column/region. Focused editors use a simple bounded form column, a stable sticky-or-bottom action row, `<details>` for advanced rules, and a dialog for destructive confirmation. Ensure no section is styled as a floating nested card.

- [ ] **Step 8: Run `npm test -- src/features/sources/index.test.ts src/features/sources/editor.test.ts`, then `npm run build`; confirm both pass.**

- [ ] **Step 9: Commit Task 3.**

```bash
git add src/features/sources/index.ts src/features/sources/index.test.ts src/features/sources/editor.ts src/features/sources/editor.test.ts src/app/bootstrap.ts src/styles.css
git commit -m "feat: separate resource overview from editors"
```

### Task 4: Scannable History and Accessible Rollback Confirmation

**Files:**
- Modify: `src/features/history/index.ts`
- Modify: `src/features/history/index.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes existing `HistoryApi`, `retryRelease`, and `rollbackPublication` contracts.
- Produces `renderRollbackDialog(record)`, `historyActionFor(record)`, and a history mount that uses native dialogs instead of `window.confirm`.
- Keeps history list navigation within `{ page: "history" }`.

- [ ] **Step 1: Write failing history dialog/action tests in `src/features/history/index.test.ts`.**

```ts
it("places eligible rollback in an overflow action and renders a confirmation dialog", () => {
  const record = publishedRecord();
  const html = renderHistory([record]);

  expect(html).toContain('data-action="open-history-menu"');
  expect(html).not.toContain('data-action="rollback"');
  expect(renderRollbackDialog(record)).toContain('data-action="confirm-rollback"');
  expect(renderRollbackDialog(record)).toContain(record.commit_sha);
});

it("explains unavailable rollback without rendering an enabled action", () => {
  const html = renderHistory([legacyRecord()]);
  expect(html).toContain("旧版发布记录没有可安全执行的文件操作清单。");
  expect(html).not.toContain('data-action="confirm-rollback"');
});
```

- [ ] **Step 2: Run `npm test -- src/features/history/index.test.ts` and confirm the new assertions fail.**

- [ ] **Step 3: Implement an overflow-menu and native-dialog history interaction.**

Replace the current always-visible rollback/retry button with a menu trigger. The menu contains retry only for pending states and rollback only for `published` records with `rollback_available !== false`. Render a `<dialog data-rollback-dialog>` with target/batch facts, the reverse-commit explanation, cancel, and confirm. On confirm, guard with an `operationPending` boolean, call the existing bridge once, then refresh records. Leave the dialog closed and render a contextual error message if the call fails.

- [ ] **Step 4: Adjust history CSS in `src/styles.css`.**

Use compact rows with stable columns for commit, target/scope, state, time, and overflow action. Add state badges using semantic color tokens; do not create card stacks. Style menu and dialog surfaces consistently with Task 2’s publish dialog.

- [ ] **Step 5: Run `npm test -- src/features/history/index.test.ts`, then `npm run build`; confirm both pass.**

- [ ] **Step 6: Commit Task 4.**

```bash
git add src/features/history/index.ts src/features/history/index.test.ts src/app/bootstrap.ts src/styles.css
git commit -m "feat: refine history actions and rollback confirmation"
```

### Task 5: Consolidate the Desktop Visual System and Cross-Feature Accessibility

**Files:**
- Modify: `src/styles.css`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/features/workbench/index.ts`
- Modify: `src/features/changes/index.ts`
- Modify: `src/features/changes/review.ts`
- Modify: `src/features/sources/index.ts`
- Modify: `src/features/sources/editor.ts`
- Modify: `src/features/history/index.ts`
- Test: `src/app/view-state.test.ts`, `src/features/workbench/index.test.ts`, `src/features/changes/index.test.ts`, `src/features/changes/review.test.ts`, `src/features/sources/index.test.ts`, `src/features/sources/editor.test.ts`, `src/features/history/index.test.ts`

**Interfaces:**
- Consumes all page renderers from Tasks 1 through 4.
- Produces consistent semantic class names, focus management helpers, and final desktop layout behavior without changing bridge APIs.

- [ ] **Step 1: Write failing semantic/accessibility markup assertions in the existing focused tests.**

```ts
it("marks the active primary navigation item and keeps GitHub status in the top bar", () => {
  const html = renderAppShell({ page: "changes" }, githubReady);

  expect(html).toContain('aria-current="page"');
  expect(html).toContain('class="app-topbar"');
  expect(html).not.toContain('class="github-authorization"');
});

it("labels review view selectors and reports async status in context", () => {
  const html = renderChangeReview(previewingState);
  expect(html).toContain('role="tablist"');
  expect(html).toContain('role="status"');
});
```

- [ ] **Step 2: Run the focused test files and confirm the new markup assertions fail.**

```bash
npm test -- src/app/view-state.test.ts src/features/workbench/index.test.ts src/features/changes/index.test.ts src/features/changes/review.test.ts src/features/sources/index.test.ts src/features/sources/editor.test.ts src/features/history/index.test.ts
```

- [ ] **Step 3: Add semantic roles, focus return, and live-region behavior in the feature renderers.**

Give page regions unique labels, ensure active navigation uses `aria-current="page"`, mark review tabs with `role="tablist"` / `role="tab"` / `role="tabpanel"`, and give in-progress mutations a local `role="status"` region. On dialog close, restore focus to the action that opened it. Dialog code must call `showModal()` only when supported and otherwise use the `open` attribute as a progressive fallback. Do not add a global toast system.

- [ ] **Step 4: Consolidate `src/styles.css` around the final token system and remove obsolete green/drawer rules.**

Keep the existing single stylesheet but organize it in this order:

```css
/* tokens and global elements */
/* shell and shared primitives */
/* workbench */
/* changes and review */
/* sources and editors */
/* history and dialogs */
/* desktop-width fallbacks */
```

Remove unused selectors for `.release-panel`, fixed `.selection-bar`, `.scope-workspace`, inline `.scope-editor`, dark green `.app-nav`, and the nav-footer GitHub panel. Verify every page uses the token palette, has visible keyboard focus, respects `prefers-reduced-motion`, avoids text overlap, and keeps controls at stable dimensions.

- [ ] **Step 5: Run all frontend tests and the production build.**

```bash
npm test
npm run build
```

Both commands must pass before the commit.

- [ ] **Step 6: Commit Task 5.**

```bash
git add src/styles.css src/app/bootstrap.ts src/features/workbench/index.ts src/features/changes/index.ts src/features/changes/review.ts src/features/sources/index.ts src/features/sources/editor.ts src/features/history/index.ts src/app/view-state.test.ts src/features/workbench/index.test.ts src/features/changes/index.test.ts src/features/changes/review.test.ts src/features/sources/index.test.ts src/features/sources/editor.test.ts src/features/history/index.test.ts
git commit -m "style: unify desktop utility interface"
```

### Task 6: End-to-End Frontend Verification and Design Evidence

**Files:**
- Modify: only files required to correct verification failures.
- Create: `docs/superpowers/verification/2026-09-04-frontend-experience-redesign.md`

**Interfaces:**
- Consumes the completed task flows and existing `npm test` / `npm run build` scripts.
- Produces concise verification evidence with screenshot paths, viewport sizes, and commands run.

- [ ] **Step 1: Run the complete frontend test suite and production build.**

```bash
npm test
npm run build
```

Record the command result and any changed files needed to correct a failure.

- [ ] **Step 2: Start a Vite development server on an available port.**

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

If port `5173` is already occupied, use the next available port and record the actual URL in the verification note.

- [ ] **Step 3: Use browser inspection to capture the required desktop states.**

Capture screenshots at `1440x960` and `1024x768` for:

```text
workbench ready state
changes list with blocked and deleted items
focused review with a selected sequence and active tab
release preview and final confirmation dialog
source/target resource overview
focused source editor with collapsed advanced rules
focused target editor
history list with overflow action and rollback dialog
one loading/error/empty state
```

Use test fixtures or temporarily injected bridge responses only in a local development harness. Do not alter production bridge contracts to create screenshots.

- [ ] **Step 4: Inspect screenshots for concrete visual regressions.**

Check and record:

```text
no clipped title, path, status, or button text
no overlapping controls at either viewport
no fixed release drawer or nested editor panel
top-bar GitHub status remains visible without crowding navigation
selection and focused-review sequence remain legible
dialogs are centered, bounded, and distinguish cancel from destructive confirmation
blue-gray is the interaction accent; green appears only on success/ready states
```

Correct any failure in the responsible feature module and rerun its focused tests plus the two global commands.

- [ ] **Step 5: Create `docs/superpowers/verification/2026-09-04-frontend-experience-redesign.md`.**

Use this exact structure:

```markdown
# Frontend Experience Redesign Verification

**Date:** 2026-09-04
**Build:** `npm run build` — PASS
**Tests:** `npm test` — PASS

## Visual Checks

| State | Viewport | Screenshot | Result |
| --- | --- | --- | --- |
| Workbench ready | 1440x960 | `...` | PASS |

## Interaction Checks

- [x] Selection persists from changes to review and back.
- [x] Publish confirms the persisted preview batch only.
- [x] Source and target editing occurs in focused pages.
- [x] Rollback is secondary and confirmation-gated.

## Issues Found and Resolved

- None.
```

- [ ] **Step 6: Run a final diff review and full verification.**

```bash
git diff HEAD~5..HEAD --check
npm test
npm run build
```

Compare the completed UI against the spec’s acceptance criteria. Confirm that no backend files, Tauri commands, bridge payloads, or unapproved dependencies changed.

- [ ] **Step 7: Commit Task 6.**

```bash
git add docs/superpowers/verification/2026-09-04-frontend-experience-redesign.md
git commit -m "docs: verify frontend experience redesign"
```

## Self-Review

### Spec Coverage

- Main navigation, top-bar GitHub status, task-first workbench, and contextual recovery states are covered by Task 1.
- Change list selection, opt-in deletions, blocked visibility, focused review, immutable preview-batch publishing, and final publish confirmation are covered by Task 2.
- Resource list/overview boundaries, dedicated source/target editors, advanced-rule disclosure, save/cancel handling, and target initialization are covered by Task 3.
- Scannable history and confirmation-gated rollback are covered by Task 4.
- Visual tokens, responsive desktop constraints, semantic controls, focus behavior, and live async status are covered by Task 5.
- Build/test, browser screenshot inspection, layout checks, and acceptance-criteria evidence are covered by Task 6.

No backend workflow, bridge payload, persistence contract, mobile layout, command palette, theme switcher, onboarding flow, or new dependency is included.

### Placeholder Scan

The plan contains no `TBD`, `TODO`, “implement later”, “fill in details”, “add appropriate error handling”, or “write tests for the above” placeholder language. Every implementation task names its files, interfaces, test target, focused command, and commit command.

### Type Consistency

- `AppView` and `ViewState` are introduced in Task 1 and consumed by Tasks 2 and 3.
- `ChangesNavigation`, `ReviewState`, and review rendering are introduced in Task 2 and used only after Task 1 navigation exists.
- `SourceResource` and `EditorNavigation` are introduced in Task 3 without changing the existing `SourcesApi` bridge contract.
- Task 4 retains `HistoryApi` and does not add a history route type beyond the `history` page already introduced in Task 1.
- Task 5 uses the render helpers defined by Tasks 1 through 4; Task 6 only validates the final application.
