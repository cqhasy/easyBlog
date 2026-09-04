import { describe, expect, it } from "vitest";
import { loadWorkbench, mountWorkbench, renderWorkbench } from "./index";
import type { Change, PublicationRecord, ScopeSummary } from "../../contracts";

const scope: ScopeSummary = {
  scope: {
    id: "scope-1",
    source_id: "source-1",
    target_id: "target-1",
    name: "文章",
    lifecycle: "active",
    revision: 1,
    selections: [],
    include_patterns: [],
    exclude_patterns: [],
    created_at: "2026-09-04T08:00:00Z",
    updated_at: "2026-09-04T08:00:00Z",
  },
  health: "ready",
  diagnostics: [],
};

const publication: PublicationRecord = {
  batch_id: "batch-1",
  commit_sha: "abc123",
  scope_id: "scope-1",
  target_id: "target-1",
  change_ids: ["change-a"],
  state: "published",
  published_at: "2026-09-04T07:00:00Z",
  rollback_commit_sha: null,
  rolled_back_at: null,
};

const change = (id: string): Change => ({
  id,
  scope_id: "scope-1",
  kind: "updated",
  source_identity: `${id}.md`,
  source_path: `${id}.md`,
  previous_path: null,
  title: id,
  selected: true,
  blocked_reason: null,
  snapshot: null,
});

class WorkbenchDomRoot {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  clickAction(action: string): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    this.clickHandler?.({
      target: {
        closest: <T extends HTMLElement>(selector: string): T | null =>
          selector === "[data-action]" ? { dataset: { action } } as unknown as T : null,
      },
    } as unknown as MouseEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("workbench", () => {
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
    expect(html).toContain("内容工作台");
    expect(html).toContain('data-action="scan"');
    expect(html).toContain('data-action="open-changes"');
  });

  it("reports an in-progress scan beside its workbench action", () => {
    const html = renderWorkbench({
      status: "ready",
      scopeName: "文章",
      pendingCount: 3,
      publicationState: "ready",
      latestPublication: null,
    }, true);

    expect(html).toContain('class="workbench-operation" role="status" aria-live="polite">正在检查变更...</p>');
  });

  it("renders a configuration recovery action instead of a change list", () => {
    expect(renderWorkbench({ status: "needs_scope" })).toContain('data-action="open-sources"');
  });

  it("loads the first active scope with its changes and newest publication", async () => {
    const state = await loadWorkbench({
      listScopes: async () => [scope],
      listChanges: async () => [
        change("change-a"),
        change("change-b"),
      ],
      scanScope: async () => ({ scope_id: "scope-1", changes: [], scanned_at: "2026-09-04T08:00:00Z" }),
      listPublications: async () => [
        { ...publication, batch_id: "older", published_at: "2026-09-03T07:00:00Z" },
        publication,
      ],
    });

    expect(state).toEqual({
      status: "ready",
      scopeName: "文章",
      pendingCount: 2,
      publicationState: "ready",
      latestPublication: publication,
    });
  });

  it("recovers to target configuration when the active scope has no target", async () => {
    const state = await loadWorkbench({
      listScopes: async () => [{ ...scope, scope: { ...scope.scope, target_id: null }, health: "needs_target" }],
      listChanges: async () => [],
      scanScope: async () => ({ scope_id: "scope-1", changes: [], scanned_at: "2026-09-04T08:00:00Z" }),
      listPublications: async () => [],
    });

    expect(state).toEqual({ status: "needs_target", scopeName: "文章" });
  });

  it("scans the active scope and opens its returned changes", async () => {
    const root = new WorkbenchDomRoot();
    const scanCalls: string[] = [];
    let openedScopeId: string | undefined;

    mountWorkbench(
      root as unknown as HTMLElement,
      {
        listScopes: async () => [scope],
        listChanges: async () => [],
        scanScope: async (scopeId) => {
          scanCalls.push(scopeId);
          return {
            scope_id: scopeId,
            changes: [change("change-after-scan")],
            scanned_at: "2026-09-04T08:15:00Z",
          };
        },
        listPublications: async () => [],
      },
      {
        openChanges: (scopeId) => {
          openedScopeId = scopeId;
        },
        openSources: () => undefined,
      },
    );

    await flushDomUpdates();
    root.clickAction("scan");
    await flushDomUpdates();

    expect(scanCalls).toEqual(["scope-1"]);
    expect(root.innerHTML).toContain('data-action="open-changes"');

    root.clickAction("open-changes");
    expect(openedScopeId).toBe("scope-1");
  });

  it("retains an actionable retry message after a loading failure", async () => {
    const state = await loadWorkbench({
      listScopes: async () => {
        throw new Error("数据库暂时不可用");
      },
      listChanges: async () => [],
      scanScope: async () => ({ scope_id: "scope-1", changes: [], scanned_at: "2026-09-04T08:00:00Z" }),
      listPublications: async () => [],
    });

    expect(state).toEqual({ status: "error", message: "数据库暂时不可用" });
    expect(renderWorkbench(state)).toContain('data-action="retry"');
  });
});
