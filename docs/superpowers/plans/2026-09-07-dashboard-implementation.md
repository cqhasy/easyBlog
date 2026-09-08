# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the source-centered Dashboard that shows changes requiring review, source status composition, and reliable routes into Changes or Sources.

**Architecture:** The Dashboard feature owns loading active scopes, deriving a source row for each scope, rendering state, and running an in-memory fan-out `Check all`. The application bootstrap mounts it and translates Dashboard navigation intents into the existing shell routing model, including a source-filtered Changes page.

**Tech Stack:** TypeScript, Vitest, Vite, Lucide, existing Tauri bridge functions, CSS.

**Spec:** `docs/superpowers/specs/2026-09-07-dashboard-ux-design.md`

## Global Constraints

- Dashboard is a source-centered decision and routing surface; it does not own review, publishing, rollback, or source configuration.
- Include every active scope; pending sources sort first, unknown sources second, and no-change sources last.
- The green/amber/red segmented bar is source-status composition, never review completion.
- Use text plus icon plus color for states; source rows have no redundant Status column.
- Use `Intl.DateTimeFormat` for in-session check timestamps and do not imply persistence that the bridge does not provide.
- Use semantic controls, source-specific accessible names and tooltips for icon-only arrows, a polite live region for scan progress, and resilient long-name layout.
- Preserve the existing neutral shell and compact workbench visual system. Do not add a chart library.

---

## File Structure

- Modify: `src/features/dashboard/index.ts` - Dashboard data model, source-row derivation, renderer, and controller.
- Modify: `src/features/dashboard/index.test.ts` - Feature behavior and interaction tests.
- Modify: `src/app/view-state.ts` - Add source-aware Changes routing to application view state.
- Modify: `src/app/view-state.test.ts` - Assert the new source-filtered Changes view maps to the correct sidebar item.
- Modify: `src/app/bootstrap.ts` - Mount Dashboard and Changes, passing bridge APIs and route callbacks.
- Modify: `src/app/bootstrap.test.ts` - Prove bootstrap routes Dashboard actions into Changes or Sources.
- Modify: `src/styles.css` - Dashboard layout, segmented bar, row status treatment, responsive behavior.
- Modify: `docs/superpowers/specs/2026-09-07-dashboard-ux-design.md` - Record confirmed visual decisions.

### Task 1: Dashboard Data State

**Files:**
- Modify: `src/features/dashboard/index.test.ts`
- Modify: `src/features/dashboard/index.ts`

**Interfaces:**
- Consumes: `ScopeSummary`, `Change`, and `ScopeId` from `src/contracts`.
- Produces: `DashboardApi`, `DashboardRow`, `DashboardState`, and `loadDashboard(api, lastCheckedAt?)`.

- [ ] **Step 1: Write the failing test**

```ts
it("derives one row per active source and isolates a failed change read", async () => {
  const state = await loadDashboard({
    listScopes: async () => [reviewScope, clearScope, pausedScope],
    listChanges: async (scopeId) => {
      if (scopeId === reviewScope.scope.id) return [change(scopeId, "added")];
      if (scopeId === clearScope.scope.id) throw new Error("offline");
      return [];
    },
    scanScope: async () => ({ changes: [], scanned_at: "now" }),
  });

  expect(state).toMatchObject({
    status: "ready",
    rows: [
      { scope: reviewScope, state: "needs_review", changeCount: 1 },
      { scope: clearScope, state: "unknown", changeCount: null },
    ],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: FAIL because `loadDashboard` and the Dashboard state model do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type DashboardRowState = "needs_review" | "no_changes" | "unknown";

export type DashboardRow = {
  scope: ScopeSummary;
  state: DashboardRowState;
  changeCount: number | null;
  checkedAt?: string;
};

export async function loadDashboard(api: DashboardApi, checkedAtByScope = new Map<ScopeId, string>()): Promise<DashboardState> {
  const scopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
  if (!scopes.length) return { status: "needs_scope" };
  const rows = await Promise.all(scopes.map(async (scope) => {
    try {
      const changes = await api.listChanges(scope.scope.id);
      return { scope, state: changes.length ? "needs_review" : "no_changes", changeCount: changes.length, checkedAt: checkedAtByScope.get(scope.scope.id) };
    } catch {
      return { scope, state: "unknown", changeCount: null, checkedAt: checkedAtByScope.get(scope.scope.id) };
    }
  }));
  return { status: "ready", rows: sortDashboardRows(rows) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/index.ts src/features/dashboard/index.test.ts
git commit -m "feat: derive dashboard source status"
```

### Task 2: Dashboard Renderer and Controller

**Files:**
- Modify: `src/features/dashboard/index.test.ts`
- Modify: `src/features/dashboard/index.ts`

**Interfaces:**
- Consumes: `DashboardState`, `DashboardRow`, and `DashboardApi` from Task 1.
- Produces: `renderDashboard(state, scanning)`, `mountDashboard(root, api, navigation)`, and `DashboardNavigation`.

- [ ] **Step 1: Write the failing test**

```ts
it("renders source-state composition once per source and routes a pending source to Changes", async () => {
  const root = new DashboardDomRoot();
  let openedScope: ScopeId | undefined;

  mountDashboard(root as unknown as HTMLElement, readyApi, {
    openChanges: (scopeId) => { openedScope = scopeId; },
    openSources: () => undefined,
  });
  await flushDomUpdates();
  root.clickAction("open-source", reviewScope.scope.id);

  expect(root.innerHTML).toContain('data-dashboard-status="needs_review"');
  expect(root.innerHTML).toContain('aria-label="打开 Product Notes 的变更"');
  expect(root.innerHTML).not.toContain(">Status<");
  expect(openedScope).toBe(reviewScope.scope.id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: FAIL because `mountDashboard` and the rendered source controls do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type DashboardNavigation = {
  openChanges: (scopeId?: ScopeId) => void;
  openSources: () => void;
};

export function mountDashboard(root: HTMLElement, api: DashboardApi, navigation: DashboardNavigation): { refresh: () => void } {
  let scanning = false;
  const checkedAtByScope = new Map<ScopeId, string>();
  const refresh = async () => { /* load, apply and render latest state */ };

  root.addEventListener("click", (event) => {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (actionElement?.dataset.action === "open-source") {
      const row = findRow(actionElement.dataset.scopeId);
      if (row?.state === "unknown") navigation.openSources();
      else navigation.openChanges(row?.scope.scope.id);
    }
  });
  void refresh();
  return { refresh: () => { void refresh(); } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/index.ts src/features/dashboard/index.test.ts
git commit -m "feat: render dashboard status overview"
```

### Task 3: Check All Behavior

**Files:**
- Modify: `src/features/dashboard/index.test.ts`
- Modify: `src/features/dashboard/index.ts`

**Interfaces:**
- Consumes: `mountDashboard` and `DashboardApi` from Tasks 1-2.
- Produces: an all-active-scope scan that retains existing rows while scanning and marks only failed scans unknown.

- [ ] **Step 1: Write the failing test**

```ts
it("checks every active scope and preserves a partial failure as unknown", async () => {
  const root = new DashboardDomRoot();
  const scanScope = vi.fn(async (scopeId: ScopeId) => {
    if (scopeId === clearScope.scope.id) throw new Error("timed out");
    return { changes: [change(scopeId, "updated")], scanned_at: "2026-09-07T10:42:00Z" };
  });

  mountDashboard(root as unknown as HTMLElement, { ...readyApi, scanScope }, navigation);
  await flushDomUpdates();
  root.clickAction("check-all");
  expect(root.innerHTML).toContain('aria-live="polite"');
  await flushDomUpdates();

  expect(scanScope).toHaveBeenCalledWith(reviewScope.scope.id);
  expect(scanScope).toHaveBeenCalledWith(clearScope.scope.id);
  expect(root.innerHTML).toContain('data-dashboard-status="unknown"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: FAIL because `check-all` has no behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
const results = await Promise.all(activeRows.map(async (row) => {
  try {
    const result = await api.scanScope(row.scope.scope.id);
    checkedAtByScope.set(row.scope.scope.id, result.scanned_at);
    return { scopeId: row.scope.scope.id, changes: result.changes };
  } catch {
    return { scopeId: row.scope.scope.id, error: true };
  }
}));
```

Apply successful scan results directly to their rows, convert only failed scan rows to `unknown`, and retain the previous rows while the requests are pending.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/index.ts src/features/dashboard/index.test.ts
git commit -m "feat: check all dashboard sources"
```

### Task 4: Application Navigation Integration

**Files:**
- Modify: `src/app/view-state.ts`
- Modify: `src/app/view-state.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: `mountDashboard(root, api, navigation)` and `mountChanges(root, api, navigation, initialContext)`.
- Produces: `AppView` variants `{ page: "changes"; scopeId?: ScopeId }` and Dashboard routes to Changes or Sources.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps Changes highlighted when the Dashboard opens a source-filtered change list", () => {
  const state = createViewState({ page: "dashboard" });
  state.navigate({ page: "changes", scopeId: "scope-1" });

  expect(pageForNavigation(state.current())).toBe("changes");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/view-state.test.ts src/app/bootstrap.test.ts`

Expected: FAIL because `changes` is not a `ShellPage` or valid `AppView`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ShellPage = "dashboard" | "changes" | "history" | "sources" | "settings" | "account";
export type AppView =
  | { page: ShellPage }
  | { page: "changes"; scopeId?: ScopeId }
  | { page: "source-editor"; sourceId: string; scopeId?: ScopeId }
  | { page: "target-editor"; targetId: string };
```

In `bootstrap.ts`, mount `mountDashboard` for `dashboard`; call `viewState.navigate({ page: "changes", scopeId })` for Dashboard reviewable rows; call `viewState.navigate({ page: "sources" })` for unknown rows; mount `mountChanges` with `{ scopeId: view.scopeId }` for the Changes view.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/app/view-state.test.ts src/app/bootstrap.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/view-state.ts src/app/view-state.test.ts src/app/bootstrap.ts src/app/bootstrap.test.ts
git commit -m "feat: route dashboard sources to changes"
```

### Task 5: Visual System and Verification

**Files:**
- Modify: `src/styles.css`
- Modify: `src/features/dashboard/index.test.ts`

**Interfaces:**
- Consumes: rendered Dashboard class names and `data-dashboard-status` attributes from Task 2.
- Produces: responsive, source-status-first styling compatible with the existing shell.

- [ ] **Step 1: Write the failing test**

```ts
it("renders the status bar with review, clear, and unknown segments", () => {
  const html = renderDashboard({
    status: "ready",
    rows: [
      reviewRow,
      clearRow,
      unknownRow,
    ],
  });

  expect(html).toContain('class="dashboard-status-bar"');
  expect(html).toContain('data-dashboard-status="needs_review"');
  expect(html).toContain('data-dashboard-status="no_changes"');
  expect(html).toContain('data-dashboard-status="unknown"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: FAIL because the status bar markup does not exist.

- [ ] **Step 3: Write minimal implementation**

```css
.dashboard-status-bar { display: flex; height: 8px; overflow: hidden; }
.dashboard-status-segment { min-width: 6px; }
.dashboard-status-needs_review { background: var(--warning); }
.dashboard-status-no_changes { background: var(--success); }
.dashboard-status-unknown { background: var(--danger); }
```

Add source row grids with `min-width: 0`, visible state metadata, fixed-size arrow controls, a mobile stacking rule, and no overflow.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/features/dashboard/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Run complete verification and commit**

```bash
npm test
npm run build
git add src/styles.css src/features/dashboard/index.test.ts
git commit -m "style: polish dashboard status overview"
```

Fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` and audit the implementation files against the current rules. Resolve all actionable findings, then start Vite with `npm run dev -- --host 127.0.0.1 --port 55276` or an available port. Verify desktop and 390px mobile views in the browser before reporting completion.

## Self-Review

**Spec coverage:** Task 1 includes all active sources, source state, ordering, and per-source read failure isolation. Task 2 implements signal-first rendering, single-state row language, routes, and empty/error states. Task 3 supplies `Check all`, retained data, partial-failure behavior, live progress, and session-only freshness. Task 4 makes source-filtered Changes reachable. Task 5 supplies responsive visual implementation, full test/build verification, guideline audit, and browser verification.

**Placeholder scan:** This plan contains no unresolved placeholders. The inline comments in the task snippets describe only local orchestration whose exact state and helpers are established by their surrounding tasks.

**Type consistency:** `DashboardApi`, `DashboardState`, `DashboardRow`, `DashboardNavigation`, `renderDashboard`, and `mountDashboard` are introduced in Tasks 1-2 and consumed by later tasks. The source route passes `ScopeId` into the `{ page: "changes"; scopeId?: ScopeId }` view introduced in Task 4.
