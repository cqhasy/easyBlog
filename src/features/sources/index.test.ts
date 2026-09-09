import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectedTarget, ScopeSummary, Source } from "../../contracts";
import {
  addSourceAndReload,
  createRepositoryRefreshController,
  createSourcesRefreshController,
  createTargetConfigurationRequestController,
  formatSourcePath,
  loadSources,
  mountSources,
  notifyScopesChanged,
  renderResourceOverview,
  renderResources,
  renderSources,
  resourcesFor,
  resourcesForCategory,
  scopeLabel,
  sourceStatusLabel,
  targetStatusLabel,
} from "./index";

const source: Source = {
  id: "source-1",
  path: "C:/content",
  name: "Content",
  type: "local_directory",
  created_at: "2026-09-02T00:00:00Z",
};

const summary: ScopeSummary = {
  scope: {
    id: "scope-1",
    source_id: source.id,
    target_id: "target-1",
    name: "Posts",
    lifecycle: "active",
    revision: 1,
    selections: [],
    include_patterns: [],
    exclude_patterns: [],
    created_at: source.created_at,
    updated_at: source.created_at,
  },
  health: "ready",
  diagnostics: [],
};

function connectedTarget(overrides: Partial<ConnectedTarget> = {}): ConnectedTarget {
  return {
    id: "target-1",
    name: "Blog",
    repository: "owner/blog",
    default_branch: "main",
    visibility: "public",
    state: "needs_configuration",
    layout: { posts_directory: "", resources_directory: "" },
    created_at: source.created_at,
    ...overrides,
  };
}

class TestFormElement {
  constructor(readonly id: string) {}
}

class SourcesDomRoot {
  innerHTML = "";
  private submitHandler: ((event: SubmitEvent) => void) | undefined;
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "submit" && typeof listener === "function") {
      this.submitHandler = listener as (event: SubmitEvent) => void;
    }
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  clickAction(action: string, dataset: Record<string, string> = {}): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const target = {
      dataset: { action, ...dataset },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }

  submit(id: string): void {
    const form = new TestFormElement(id);
    this.submitHandler?.({
      target: form,
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sources feature", () => {
  it("returns ready state with sources after loading", async () => {
    const state = await loadSources({ listSources: vi.fn().mockResolvedValue([source]) });
    expect(state).toEqual({ status: "ready", sources: [source] });
    expect(renderSources(state)).toContain("C:/content");
  });

  it("returns empty state for no registered sources", async () => {
    const state = await loadSources({ listSources: vi.fn().mockResolvedValue([]) });
    expect(state).toEqual({ status: "empty" });
    expect(renderSources(state)).toContain("尚未添加本地目录");
  });

  it("returns error state when loading fails", async () => {
    const state = await loadSources({
      listSources: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    expect(state).toEqual({ status: "error", message: "database unavailable" });
    expect(renderSources(state)).toContain("database unavailable");
  });

  it("uses the fallback when an Error has no message", async () => {
    const state = await loadSources({ listSources: vi.fn().mockRejectedValue(new Error()) });
    expect(state).toEqual({ status: "error", message: "来源无法加载" });
  });

  it("preserves structured Tauri error messages", async () => {
    const state = await loadSources({
      listSources: vi.fn().mockRejectedValue({ code: "duplicate_source", message: "目录已添加" }),
    });
    expect(state).toEqual({ status: "error", message: "目录已添加" });
  });

  it("removes the Windows extended path prefix for display", () => {
    expect(formatSourcePath("\\\\?\\D:\\markdown")).toBe("D:\\markdown");
    expect(formatSourcePath("\\\\?\\UNC\\server\\share")).toBe("\\\\server\\share");
  });

  it("labels blocked scopes as blocked", () => {
    const summary: ScopeSummary = {
      scope: {
        id: "scope-1",
        source_id: source.id,
        target_id: "target-1",
        name: "Posts",
        lifecycle: "active",
        revision: 1,
        selections: [],
        include_patterns: [],
        exclude_patterns: [],
        created_at: source.created_at,
        updated_at: source.created_at,
      },
      health: "blocked",
      diagnostics: [],
    };

    expect(scopeLabel(summary)).toBe("已阻塞");
  });

  it("summarizes source state from its scopes", () => {
    expect(sourceStatusLabel([])).toBe("未配置");
    expect(sourceStatusLabel([summary])).toBe("可用");
    expect(sourceStatusLabel([{ ...summary, health: "needs_target" }])).toBe("待绑定目标");
    expect(sourceStatusLabel([{ ...summary, health: "blocked" }])).toBe("已阻塞");
    expect(sourceStatusLabel([{ ...summary, scope: { ...summary.scope, lifecycle: "paused" } }])).toBe("已暂停");
    expect(sourceStatusLabel([{ ...summary, scope: { ...summary.scope, lifecycle: "deleted" } }])).toBe("未配置");
  });

  it("labels connected target states", () => {
    expect(targetStatusLabel(connectedTarget({ state: "ready" }))).toBe("可用");
    expect(targetStatusLabel(connectedTarget({ state: "needs_configuration" }))).toBe("待配置");
    expect(targetStatusLabel(connectedTarget({ state: "needs_reconnect" }))).toBe("需要重新连接");
    expect(targetStatusLabel(connectedTarget({ state: "needs_recovery" }))).toBe("需要修复");
  });

  it("filters resource relationships by the active category", () => {
    const resources = resourcesFor([source], [summary], [connectedTarget()]);
    expect(resourcesForCategory(resources, "sources").every((item) => item.kind === "source")).toBe(true);
    expect(resourcesForCategory(resources, "targets").every((item) => item.kind === "target")).toBe(true);
  });

  it("reloads the persisted list after adding a source", async () => {
    const addSource = vi.fn().mockResolvedValue(source);
    const listSources = vi.fn().mockResolvedValue([source]);
    const state = await addSourceAndReload({ addSource, listSources }, { path: "C:/content" });
    expect(addSource).toHaveBeenCalledWith({ path: "C:/content" });
    expect(listSources).toHaveBeenCalledOnce();
    expect(state).toEqual({ status: "ready", sources: [source] });
  });

  it("notifies the workbench after a successful scope-changing operation", () => {
    const onScopesChanged = vi.fn();
    notifyScopesChanged(onScopesChanged);
    expect(onScopesChanged).toHaveBeenCalledOnce();
  });

  it("keeps the latest refresh result when an earlier request resolves last", async () => {
    let resolveFirst!: (value: Source[]) => void;
    let resolveSecond!: (value: Source[]) => void;
    const first = new Promise<Source[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Source[]>((resolve) => {
      resolveSecond = resolve;
    });
    const listSources = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const applied: Source[][] = [];
    const controller = createSourcesRefreshController({ listSources }, (state) => {
      if (state.status === "ready") applied.push(state.sources);
    });

    const initialRefresh = controller.refresh();
    const retryRefresh = controller.refresh();
    resolveSecond([source]);
    await retryRefresh;
    resolveFirst([]);
    await initialRefresh;

    expect(applied).toEqual([[source]]);
  });

  it("does not start a second repository refresh while the first is pending", async () => {
    let resolve!: (value: Array<{ repository: string; default_branch: string; visibility: "public" }>) => void;
    const pending = new Promise<Array<{ repository: string; default_branch: string; visibility: "public" }>>((next) => {
      resolve = next;
    });
    const load = vi.fn().mockReturnValue(pending);
    const apply = vi.fn();
    const controller = createRepositoryRefreshController(load, apply);

    const first = controller.refresh();
    const duplicate = controller.refresh();
    expect(controller.isLoading()).toBe(true);
    expect(load).toHaveBeenCalledOnce();

    resolve([{ repository: "owner/blog", default_branch: "main", visibility: "public" }]);
    await Promise.all([first, duplicate]);

    expect(controller.isLoading()).toBe(false);
    expect(apply).toHaveBeenCalledWith([{ repository: "owner/blog", default_branch: "main", visibility: "public" }]);
  });

  it("invalidates an inspection when the configuration target changes", () => {
    const controller = createTargetConfigurationRequestController();
    const first = controller.begin();
    const second = controller.begin();

    expect(controller.isCurrent(first)).toBe(false);
    expect(controller.isCurrent(second)).toBe(true);
  });

  it("renders source and target resources without embedding an editor form", () => {
    const html = renderResourceOverview({
      kind: "source",
      id: source.id,
      source,
      scopes: [summary],
    });

    expect(html).toContain('data-action="edit-source"');
    expect(html).not.toContain('id="scope-form"');
    expect(html).not.toContain('name="posts-directory"');
  });

  it("renders an actionable target-empty state", () => {
    expect(renderResources({ status: "ready", sources: [source], scopes: [], targets: [] }))
      .toContain('data-action="connect-target"');
  });

  it("renders source and target tabs with only the active category in the master list", () => {
    const target = connectedTarget();
    const html = renderResources({
      status: "ready",
      sources: [source],
      scopes: [summary],
      targets: [target],
    });

    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab" aria-selected="true" data-action="select-category" data-category="sources"');
    expect(html).toContain('role="tab" aria-selected="false" data-action="select-category" data-category="targets"');
    expect(html).toContain("Content");
    expect(html).toContain("owner/blog");

    const targetHtml = renderResources(
      { status: "ready", sources: [source], scopes: [summary], targets: [target] },
      "targets",
    );
    expect(targetHtml).toContain("owner/blog");
    expect(targetHtml).not.toContain('data-action="select-resource" data-resource-id="source-1"');
  });

  it("renders source detail with range binding and a new-range action", () => {
    const target = connectedTarget({ state: "ready" });
    const html = renderResources(
      { status: "ready", sources: [source], scopes: [summary], targets: [target] },
      "sources",
      source.id,
    );
    expect(html).toContain("同步范围");
    expect(html).toContain("Posts");
    expect(html).toContain("owner/blog");
    expect(html).toContain("同步状态");
    expect(html).toContain("编辑来源");
    expect(html).toContain('data-scope-id="scope-1"');
  });

  it("renders target detail without an inline editor", () => {
    const target = connectedTarget();
    const html = renderResources(
      { status: "ready", sources: [source], scopes: [summary], targets: [target] },
      "targets",
      target.id,
    );
    expect(html).toContain("GitHub 目标");
    expect(html).toContain("owner/blog");
    expect(html).toContain("发布配置");
    expect(html).toContain('data-action="edit-target"');
    expect(html).not.toContain('id="target-editor-form"');
  });

  it("keeps setup actions available when the selected category is empty", () => {
    const html = renderResources({ status: "ready", sources: [source], scopes: [], targets: [] }, "targets");
    expect(html).toContain("尚未连接发布目标");
    expect(html).toContain('data-action="connect-target"');
    expect(html).not.toContain("<strong>Content</strong>");
  });

  it("renders the global empty state with both setup paths", () => {
    const html = renderResources({ status: "empty" });
    expect(html).toContain('data-action="add-source"');
    expect(html).toContain('data-action="connect-target"');
    expect(html).toContain("从一个内容来源开始");
  });

  it("renders source setup in a modal dialog with icon controls", () => {
    const html = renderResources({ status: "empty" }, "sources", undefined, "add-source");

    expect(html).toContain('<dialog class="resource-action-dialog" data-resource-action-dialog');
    expect(html).toContain('id="add-source-form"');
    expect(html).toContain('data-action="close-resource-action"');
    expect(html).toContain('data-lucide="x"');
    expect(html).not.toContain('class="resource-action-panel"');
  });

  it("renders target setup with a refresh icon instead of a secondary text button", () => {
    const html = renderResources(
      { status: "empty" },
      "sources",
      undefined,
      "connect-target",
      [{
        repository: "owner/blog",
        default_branch: "main",
        visibility: "public",
        description: null,
      }],
      "owner/blog",
    );

    expect(html).toContain('<dialog class="resource-action-dialog" data-resource-action-dialog');
    expect(html).toContain('data-action="refresh-repositories"');
    expect(html).toContain('data-lucide="refresh-cw"');
    expect(html).toContain('data-lucide="git-branch"');
    expect(html).not.toContain('data-lucide="github"');
    expect(html).not.toContain(">重新加载</button>");
  });

  it("uses the compact sources header action hierarchy", () => {
    const html = renderResources({
      status: "ready",
      sources: [source],
      scopes: [summary],
      targets: [],
    });

    expect(html).toContain('<p class="eyebrow">内容资源</p>');
    expect(html).not.toContain("EASYBLOG / SOURCES");
    expect(html).toContain('<section class="resource-overview-region" aria-label="资源详情">');
    expect(html).toContain('class="task-primary-button resource-add-button" data-action="add-source"');
    expect(html).toContain('class="secondary-button resource-connect-button" data-action="connect-target"');
    expect(renderResourceOverview({
      kind: "source",
      id: source.id,
      source,
      scopes: [summary],
    })).toContain('class="secondary-button resource-edit-source-button" data-action="edit-source"');
  });

  it("matches the confirmed wireframe hierarchy in the master-detail list", () => {
    const html = renderResources({
      status: "ready",
      sources: [source],
      scopes: [summary],
      targets: [],
    });

    expect(html).toContain('class="resource-list-icon"');
    expect(html).toContain('data-lucide="folder-open"');
    expect(html).toContain('<strong class="resource-list-name">Content</strong>');
    expect(html).toContain('<span class="resource-list-meta">本地目录 · 1 个同步范围</span>');
    expect(html).toContain('<span class="resource-list-path">C:/content</span>');
    expect(html).toContain('class="resource-list-state source-state-ready"');
    expect(html).not.toContain('name="resource-search"');
    expect(html).toContain('class="resource-scope-target"');
  });

  it("labels loading, error, and ready resource regions from the same page heading", () => {
    const states = [
      renderResources({ status: "loading" }),
      renderResources({ status: "error", message: "资源不可用" }),
      renderResources({ status: "ready", sources: [source], scopes: [summary], targets: [] }),
    ];

    for (const html of states) {
      expect(html).toContain('<section class="sources-page resource-page" aria-labelledby="sources-title">');
      expect(html).toContain('<h1 id="sources-title">内容来源</h1>');
      expect(html).not.toContain("<main");
    }
  });

  it("switches category and never leaves source detail beside the target list", async () => {
    const target = connectedTarget();
    const root = new SourcesDomRoot();
    mountSources(root as unknown as HTMLElement, {
      listSources: vi.fn().mockResolvedValue([source]),
      listScopes: vi.fn().mockResolvedValue([summary]),
      listTargets: vi.fn().mockResolvedValue([target]),
    });

    await flushDomUpdates();
    root.clickAction("select-category", { category: "targets" });

    expect(root.innerHTML).toContain("owner/blog");
    expect(root.innerHTML).not.toContain("范围与绑定");
    expect(root.innerHTML).toContain("GitHub 目标");
  });

  it("selects the first target after entering the target tab when no target was selected", async () => {
    const target = connectedTarget();
    const root = new SourcesDomRoot();
    mountSources(root as unknown as HTMLElement, {
      listSources: vi.fn().mockResolvedValue([source]),
      listScopes: vi.fn().mockResolvedValue([summary]),
      listTargets: vi.fn().mockResolvedValue([target]),
    });

    await flushDomUpdates();
    root.clickAction("select-category", { category: "targets" });

    expect(root.innerHTML).toContain(`data-resource-id="${target.id}" aria-current="true"`);
  });

  it("opens the source and target focused editors from the selected category", async () => {
    const target = connectedTarget();
    const root = new SourcesDomRoot();
    const openSourceEditor = vi.fn();
    const openTargetEditor = vi.fn();
    mountSources(root as unknown as HTMLElement, {
      listSources: vi.fn().mockResolvedValue([source]),
      listScopes: vi.fn().mockResolvedValue([summary]),
      listTargets: vi.fn().mockResolvedValue([target]),
    }, { openSourceEditor, openTargetEditor });

    await flushDomUpdates();
    root.clickAction("edit-source", { sourceId: source.id });
    expect(openSourceEditor).toHaveBeenCalledWith(source.id, undefined);

    root.clickAction("select-category", { category: "targets" });
    root.clickAction("edit-target", { targetId: target.id });
    expect(openTargetEditor).toHaveBeenCalledWith(target.id);
  });

  it("hydrates Lucide icons after rendering Sources", async () => {
    const root = new SourcesDomRoot();
    const hydrate = vi.fn();
    mountSources(root as unknown as HTMLElement, {
      listSources: vi.fn().mockResolvedValue([source]),
      listScopes: vi.fn().mockResolvedValue([summary]),
      listTargets: vi.fn().mockResolvedValue([]),
    }, undefined, undefined, undefined, hydrate);

    await flushDomUpdates();

    expect(hydrate).toHaveBeenCalled();
  });

  it("does not open a connected target after the Sources mount is no longer active", async () => {
    vi.stubGlobal("HTMLFormElement", TestFormElement);
    const root = new SourcesDomRoot();
    const openTargetEditor = vi.fn();
    let active = true;
    let resolveConnectedTarget!: (target: ConnectedTarget) => void;
    const connectTarget = vi.fn(() => new Promise<ConnectedTarget>((resolve) => {
      resolveConnectedTarget = resolve;
    }));

    mountSources(root as unknown as HTMLElement, {
      listSources: async () => [],
      listScopes: async () => [],
      listTargets: async () => [],
      refreshGithubRepositoryPermissions: async () => [{
        repository: "owner/blog",
        default_branch: "main",
        visibility: "public",
        description: null,
      }],
      connectTarget,
    }, {
      openSourceEditor: vi.fn(),
      openTargetEditor,
    }, undefined, () => active);

    await flushDomUpdates();
    root.clickAction("connect-target");
    await flushDomUpdates();
    root.submit("connect-target-form");
    active = false;
    resolveConnectedTarget({
      id: "target-1",
      name: "Blog",
      repository: "owner/blog",
      default_branch: "main",
      visibility: "public",
      state: "needs_configuration",
      layout: { posts_directory: "", resources_directory: "" },
      created_at: source.created_at,
    });
    await flushDomUpdates();

    expect(connectTarget).toHaveBeenCalledOnce();
    expect(openTargetEditor).not.toHaveBeenCalled();
  });
});
