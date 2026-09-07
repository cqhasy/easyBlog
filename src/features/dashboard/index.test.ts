import { describe, expect, it, vi } from "vitest";

import { renderDashboard } from "./index";
import * as dashboard from "./index";
import type { Change, ScopeId, ScopeSummary } from "../../contracts";

const reviewScope: ScopeSummary = {
  scope: {
    id: "scope-review",
    source_id: "source-review",
    target_id: null,
    name: "Product Notes",
    lifecycle: "active",
    revision: 1,
    selections: [{ node: { kind: "local_path", value: "/notes" }, recursive: true, display_name: "Notes" }],
    include_patterns: [],
    exclude_patterns: [],
    created_at: "now",
    updated_at: "now",
  },
  health: "ready",
  diagnostics: [],
};

function change(scopeId: ScopeId, id: string): Change {
  return {
    id,
    scope_id: scopeId,
    kind: "updated",
    source_identity: `${id}.md`,
    source_path: `${id}.md`,
    previous_path: null,
    title: id,
    selected: true,
    blocked_reason: null,
    snapshot: null,
  };
}

class DashboardDomRoot {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  clickAction(action: string, scopeId?: ScopeId): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const target = {
      dataset: scopeId ? { action, scopeId } : { action },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("dashboard", () => {
  it("renders a source-status composition instead of a publishing workflow", () => {
    const html = renderDashboard({
      status: "ready",
      rows: [
        { scope: reviewScope, state: "needs_review", changeCount: 3 },
        { scope: { ...reviewScope, scope: { ...reviewScope.scope, id: "scope-clear", name: "Release Notes" } }, state: "no_changes", changeCount: 0 },
        { scope: { ...reviewScope, scope: { ...reviewScope.scope, id: "scope-unknown", name: "Team Handbook" } }, state: "unknown", changeCount: null },
      ],
    });

    expect(html).toContain('class="dashboard-overview"');
    expect(html).toContain('data-dashboard-status="needs_review"');
    expect(html).toContain('data-dashboard-status="no_changes"');
    expect(html).toContain('data-dashboard-status="unknown"');
    expect(html).toContain('aria-label="打开 Product Notes 的变更"');
    expect(html).toContain("本地文件夹 · 本会话尚未检查");
    expect(html).toContain(">3 项变更<");
    expect(html).toContain('class="dashboard-summary-ring"');
    expect(html).toContain('aria-label="3 项待评审变更，2 / 3 个来源已检查，最近成功检查：本会话尚未检查"');
    expect(html).not.toContain("内容概览");
    expect(html).not.toContain('data-action="open-changes"');
    expect(html).not.toContain(">—<");
    expect(html).not.toContain("· 需要评审 ·");
    expect(html).not.toContain("· 无变更 ·");
    expect(html).not.toContain(">无变更<");
    expect(html).not.toContain(">状态未知<");
    expect(html).not.toContain("发布");
    expect(html).not.toContain(">Status<");
  });

  it("states that a source has not been checked this session when no scan timestamp is available", () => {
    const html = renderDashboard({
      status: "ready",
      rows: [{ scope: reviewScope, state: "no_changes", changeCount: 0 }],
    });

    expect(html).toContain("本会话尚未检查");
  });

  it("derives one row per active source and isolates a failed change read", async () => {
    const clearScope: ScopeSummary = {
      ...reviewScope,
      scope: { ...reviewScope.scope, id: "scope-clear", name: "Release Notes" },
    };
    const pausedScope: ScopeSummary = {
      ...reviewScope,
      scope: { ...reviewScope.scope, id: "scope-paused", lifecycle: "paused" },
    };
    const { loadDashboard } = dashboard as unknown as {
      loadDashboard: (api: {
        listScopes: () => Promise<ScopeSummary[]>;
        listChanges: (scopeId: ScopeId) => Promise<Change[]>;
        scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
      }) => Promise<unknown>;
    };

    expect(loadDashboard).toBeTypeOf("function");

    const state = await loadDashboard({
      listScopes: async () => [clearScope, pausedScope, reviewScope],
      listChanges: async (scopeId) => {
        if (scopeId === clearScope.scope.id) throw new Error("offline");
        return [change(scopeId, "change-1")];
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

  it("routes reviewable sources to Changes and unknown sources to Sources", async () => {
    const unknownScope: ScopeSummary = {
      ...reviewScope,
      scope: { ...reviewScope.scope, id: "scope-unknown", name: "Team Handbook" },
    };
    const root = new DashboardDomRoot();
    let openedScopeId: ScopeId | undefined;
    let openedSources = 0;
    const { mountDashboard } = dashboard as unknown as {
      mountDashboard: (
        root: HTMLElement,
        api: {
          listScopes: () => Promise<ScopeSummary[]>;
          listChanges: (scopeId: ScopeId) => Promise<Change[]>;
          scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
        },
        navigation: {
          openChanges: (scopeId?: ScopeId) => void;
          openSources: () => void;
        },
      ) => { refresh: () => void };
    };

    expect(mountDashboard).toBeTypeOf("function");

    mountDashboard(root as unknown as HTMLElement, {
      listScopes: async () => [reviewScope, unknownScope],
      listChanges: async (scopeId) => {
        if (scopeId === unknownScope.scope.id) throw new Error("offline");
        return [change(scopeId, "change-1")];
      },
      scanScope: async () => ({ changes: [], scanned_at: "now" }),
    }, {
      openChanges: (scopeId) => { openedScopeId = scopeId; },
      openSources: () => { openedSources += 1; },
    });

    await flushDomUpdates();
    root.clickAction("open-source", reviewScope.scope.id);
    root.clickAction("open-source", unknownScope.scope.id);

    expect(openedScopeId).toBe(reviewScope.scope.id);
    expect(openedSources).toBe(1);
  });

  it("notifies the host after Dashboard renders new source rows", async () => {
    const root = new DashboardDomRoot();
    const onRendered = vi.fn();
    const { mountDashboard } = dashboard as unknown as {
      mountDashboard: (
        root: HTMLElement,
        api: {
          listScopes: () => Promise<ScopeSummary[]>;
          listChanges: (scopeId: ScopeId) => Promise<Change[]>;
          scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
        },
        navigation: {
          openChanges: (scopeId?: ScopeId) => void;
          openSources: () => void;
        },
        onRendered: () => void,
      ) => { refresh: () => void };
    };

    mountDashboard(root as unknown as HTMLElement, {
      listScopes: async () => [reviewScope],
      listChanges: async () => [change(reviewScope.scope.id, "change-1")],
      scanScope: async () => ({ changes: [], scanned_at: "now" }),
    }, {
      openChanges: () => undefined,
      openSources: () => undefined,
    }, onRendered);

    await flushDomUpdates();

    expect(onRendered).toHaveBeenCalledTimes(2);
  });

  it("checks every active source and keeps a partial failure unknown", async () => {
    const clearScope: ScopeSummary = {
      ...reviewScope,
      scope: { ...reviewScope.scope, id: "scope-clear", name: "Release Notes" },
    };
    const root = new DashboardDomRoot();
    let resolveReviewScan!: (value: { changes: Change[]; scanned_at: string }) => void;
    const reviewScan = new Promise<{ changes: Change[]; scanned_at: string }>((resolve) => {
      resolveReviewScan = resolve;
    });
    const scanScope = vi.fn((scopeId: ScopeId) => {
      if (scopeId === reviewScope.scope.id) return reviewScan;
      return Promise.reject(new Error("timed out"));
    });
    const { mountDashboard } = dashboard as unknown as {
      mountDashboard: (
        root: HTMLElement,
        api: {
          listScopes: () => Promise<ScopeSummary[]>;
          listChanges: (scopeId: ScopeId) => Promise<Change[]>;
          scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
        },
        navigation: {
          openChanges: (scopeId?: ScopeId) => void;
          openSources: () => void;
        },
      ) => { refresh: () => void };
    };

    mountDashboard(root as unknown as HTMLElement, {
      listScopes: async () => [reviewScope, clearScope],
      listChanges: async () => [],
      scanScope,
    }, {
      openChanges: () => undefined,
      openSources: () => undefined,
    });

    await flushDomUpdates();
    root.clickAction("check-all");

    expect(root.innerHTML).toContain('aria-live="polite">正在检查所有来源...</p>');
    expect(scanScope).toHaveBeenCalledWith(reviewScope.scope.id);
    expect(scanScope).toHaveBeenCalledWith(clearScope.scope.id);

    resolveReviewScan({ changes: [change(reviewScope.scope.id, "change-1")], scanned_at: "2026-09-07T10:42:00Z" });
    await flushDomUpdates();
    await flushDomUpdates();

    expect(root.innerHTML).toContain('data-dashboard-status="needs_review"');
    expect(root.innerHTML).toContain('data-dashboard-status="unknown"');
    expect(root.innerHTML).toContain(new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date("2026-09-07T10:42:00Z")));
  });

  it("keeps completed scan times when Dashboard is mounted again", async () => {
    const checkedAtByScope = new Map<ScopeId, string>();
    const firstRoot = new DashboardDomRoot();
    const secondRoot = new DashboardDomRoot();
    const { mountDashboard } = dashboard;
    const api = {
      listScopes: async () => [reviewScope],
      listChanges: async () => [],
      scanScope: async () => ({ changes: [], scanned_at: "2026-09-07T10:42:00Z" }),
    };
    const navigation = { openChanges: () => undefined, openSources: () => undefined };
    const formattedTime = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date("2026-09-07T10:42:00Z"));

    mountDashboard(firstRoot as unknown as HTMLElement, api, navigation, undefined, checkedAtByScope);
    await flushDomUpdates();
    firstRoot.clickAction("check-all");
    await flushDomUpdates();
    await flushDomUpdates();

    mountDashboard(secondRoot as unknown as HTMLElement, api, navigation, undefined, checkedAtByScope);
    await flushDomUpdates();

    expect(secondRoot.innerHTML).toContain(formattedTime);
  });
});
