import { describe, expect, it, vi } from "vitest";
import { buildChangeTree, changeTreeSelectionState, createChangesRefreshController, defaultSelectedChanges, groupChanges, loadChanges, mountChanges, reconcileSelectedChangeIds, renderChanges, selectableChanges } from "./index";
import type { Change, ScopeSummary } from "../../contracts";

const scope: ScopeSummary = {
  scope: { id: "scope-1", source_id: "source-1", target_id: null, name: "文章", lifecycle: "active", revision: 1, selections: [], include_patterns: [], exclude_patterns: [], created_at: "now", updated_at: "now" },
  health: "needs_target",
  diagnostics: [],
};

function change(kind: Change["kind"], id: string = kind): Change {
  return { id, scope_id: "scope-1", kind, source_identity: `${id}.md`, source_path: `${id}.md`, previous_path: kind === "moved" ? "old.md" : null, title: id, selected: kind !== "deleted" && kind !== "blocked", blocked_reason: kind === "blocked" ? "无法解析内容" : null, snapshot: null };
}

class ChangesDomRoot {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;
  private changeHandler: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
    if (type === "change" && typeof listener === "function") {
      this.changeHandler = listener as (event: Event) => void;
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

  changeTreeSelection(input: HTMLInputElement): void {
    this.changeHandler?.({
      target: input,
    } as unknown as Event);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("changes workspace", () => {
  it("builds a nested tree from normalized source paths with folders before files", () => {
    const nested = { ...change("updated", "guide"), source_path: "docs\\guides\\git.md" };
    const rootFile = { ...change("added", "readme"), source_path: "README.md" };
    const docsFile = { ...change("deleted", "release"), source_path: "docs/release.md" };

    expect(buildChangeTree([nested, rootFile, docsFile])).toEqual([
      {
        type: "folder",
        id: "folder:docs",
        name: "docs",
        children: [
          { type: "folder", id: "folder:docs/guides", name: "guides", children: [{ type: "file", change: nested }] },
          { type: "file", change: docsFile },
        ],
      },
      { type: "file", change: rootFile },
    ]);
  });

  it("reports checked and mixed folder selections from selectable descendant files", () => {
    const tree = buildChangeTree([change("added", "a"), change("deleted", "b"), change("blocked", "c")]);

    expect(changeTreeSelectionState(tree, new Set(["a"]))).toBe("mixed");
    expect(changeTreeSelectionState(tree, new Set(["a", "b"]))).toBe("checked");
    expect(changeTreeSelectionState(tree, new Set())).toBe("unchecked");
  });

  it("groups changes in review order while keeping deletions manual by default", () => {
    const changes = [change("deleted"), change("added"), change("blocked"), change("updated")];
    expect(groupChanges(changes).map((group) => group.kind)).toEqual(["blocked", "added", "updated", "deleted"]);
    expect(selectableChanges(changes).map((item) => item.kind)).toEqual(["deleted", "added", "updated"]);
    expect(defaultSelectedChanges(changes).map((item) => item.kind)).toEqual(["added", "updated"]);
  });

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

  it("keeps deletions opt-in when a persisted record is marked selected", () => {
    const deleted = { ...change("deleted"), selected: true };

    expect(defaultSelectedChanges([deleted])).toEqual([]);
  });

  it("renders blocked context and offers focused review for publishable selections", () => {
    const html = renderChanges({ status: "ready", scope, changes: [change("blocked"), change("added")], scannedAt: "2026-09-02T00:00:00Z" }, new Set(["added"]));
    expect(html).toContain("需要处理");
    expect(html).toContain("无法解析内容");
    expect(html).toContain("进入评审</button>");
    expect(html).toContain('data-action="open-review"');
    expect(html).not.toContain('data-action="preview"');
  });

  it("uses the file name as the primary label and keeps a Markdown title secondary", () => {
    const guide = { ...change("updated", "git-guide"), source_path: "docs/git-basics.md", title: "（1）git的初始操作与基础用法" };

    const html = renderChanges({ status: "ready", scope, changes: [guide], scannedAt: "2026-09-02T00:00:00Z" }, new Set([guide.id]));

    expect(html).toContain("<strong>git-basics</strong>");
    expect(html).not.toContain("<strong>git-basics.md</strong>");
    expect(html).toContain('class="change-article-title">（1）git的初始操作与基础用法</span>');
  });

  it("reports an in-progress scan in the changes control region", () => {
    const html = renderChanges(
      { status: "ready", scope, changes: [change("added")], scannedAt: "2026-09-02T00:00:00Z" },
      new Set(["added"]),
      true,
    );

    expect(html).toContain('class="changes-operation" role="status" aria-live="polite">正在检测变更...</p>');
  });

  it("provides a Dashboard return route", async () => {
    const root = new ChangesDomRoot();
    const backToDashboard = vi.fn();

    mountChanges(root as unknown as HTMLElement, {
      listScopes: async () => [scope],
      listChanges: async () => [change("added")],
      scanScope: async () => ({ changes: [], scanned_at: "now" }),
    }, {
      openReview: () => undefined,
      openSources: () => undefined,
      backToDashboard,
    });

    await flushDomUpdates();
    root.clickAction("back-to-dashboard");

    expect(backToDashboard).toHaveBeenCalledOnce();
  });

  it("notifies the shell after rendering so icons can be hydrated", async () => {
    const root = new ChangesDomRoot();
    const onRendered = vi.fn();

    mountChanges(root as unknown as HTMLElement, {
      listScopes: async () => [scope],
      listChanges: async () => [change("added")],
      scanScope: async () => ({ changes: [], scanned_at: "now" }),
    }, {
      openReview: () => undefined,
      openSources: () => undefined,
      backToDashboard: () => undefined,
    }, {}, onRendered);

    await flushDomUpdates();

    expect(onRendered).toHaveBeenCalled();
  });

  it("selects and clears a folder containing a comma-bearing change ID", async () => {
    class TestSelectElement { dataset: DOMStringMap = {} as DOMStringMap; }
    class TestInputElement { dataset: DOMStringMap = {} as DOMStringMap; checked = false; }
    vi.stubGlobal("HTMLSelectElement", TestSelectElement);
    vi.stubGlobal("HTMLInputElement", TestInputElement);
    const root = new ChangesDomRoot();
    const commaId = "source:docs/a,b.md";
    const reviewContexts: Array<{ selectedChangeIds: string[] }> = [];

    mountChanges(root as unknown as HTMLElement, {
      listScopes: async () => [scope],
      listChanges: async () => [{ ...change("added", commaId), source_path: "docs/a,b.md" }],
      scanScope: async () => ({ changes: [], scanned_at: "now" }),
    }, {
      openReview: (context) => { reviewContexts.push(context); },
      openSources: () => undefined,
      backToDashboard: () => undefined,
    });

    await flushDomUpdates();
    const folderInput = new TestInputElement();
    folderInput.dataset = { action: "toggle-tree-selection", changeIds: JSON.stringify([commaId]) } as DOMStringMap;
    folderInput.checked = true;
    root.changeTreeSelection(folderInput as unknown as HTMLInputElement);
    root.clickAction("open-review");

    expect(reviewContexts).toEqual([expect.objectContaining({ selectedChangeIds: [commaId] })]);

    folderInput.checked = false;
    root.changeTreeSelection(folderInput as unknown as HTMLInputElement);
    root.clickAction("open-review");

    expect(reviewContexts).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("opens review in the explicit selected order rather than backend list order", async () => {
    const root = new ChangesDomRoot();
    let reviewContext: { scopeId: string; selectedChangeIds: string[]; activeChangeId: string } | undefined;

    mountChanges(
      root as unknown as HTMLElement,
      {
        listScopes: async () => [scope],
        listChanges: async () => [change("added", "a"), change("updated", "b")],
        scanScope: async () => ({ changes: [], scanned_at: "now" }),
      },
      {
        openReview: (context) => { reviewContext = context; },
        openSources: () => undefined,
        backToDashboard: () => undefined,
      },
      { scopeId: scope.scope.id, selectedChangeIds: ["b", "a"] },
    );

    await flushDomUpdates();
    root.clickAction("open-review");

    expect(reviewContext).toEqual({
      scopeId: "scope-1",
      selectedChangeIds: ["b", "a"],
      activeChangeId: "b",
    });
  });

  it("loads persisted changes for the first active scope", async () => {
    const state = await loadChanges({ listScopes: async () => [scope], listChanges: async () => [change("added")], scanScope: async () => ({ changes: [], scanned_at: "now" }) });
    expect(state).toMatchObject({ status: "ready", scope, changes: [expect.objectContaining({ kind: "added" })] });
  });

  it("keeps the newest workbench refresh when source changes arrive during a pending read", async () => {
    let resolveFirst!: (value: ScopeSummary[]) => void;
    let resolveSecond!: (value: ScopeSummary[]) => void;
    const first = new Promise<ScopeSummary[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<ScopeSummary[]>((resolve) => { resolveSecond = resolve; });
    const listScopes = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const listChanges = vi.fn().mockResolvedValue([change("added")]);
    const applied: string[] = [];
    const controller = createChangesRefreshController({ listScopes, listChanges, scanScope: async () => ({ changes: [], scanned_at: "now" }) }, (state) => {
      if (state.status === "ready") applied.push(state.scope.scope.id);
    });

    const initial = controller.refresh();
    const afterSourceChange = controller.refresh();
    resolveSecond([scope]);
    await afterSourceChange;
    resolveFirst([]);
    await initial;

    expect(applied).toEqual([scope.scope.id]);
    expect(listChanges).toHaveBeenCalledOnce();
  });

  it("uses the requested scope when refresh is triggered after a scope change", async () => {
    const anotherScope = { ...scope, scope: { ...scope.scope, id: "scope-2", name: "另一范围" } };
    const applied: ScopeSummary[] = [];
    const controller = createChangesRefreshController({ listScopes: async () => [scope, anotherScope], listChanges: async () => [], scanScope: async () => ({ changes: [], scanned_at: "now" }) }, (state) => {
      if (state.status === "empty") applied.push(state.scope);
    });

    await controller.refresh(anotherScope.scope.id);

    expect(applied).toEqual([anotherScope]);
  });
});
