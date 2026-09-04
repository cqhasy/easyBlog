import { describe, expect, it, vi } from "vitest";
import type { ScopeSummary, Source } from "../../contracts";
import {
  addSourceAndReload,
  createRepositoryRefreshController,
  createSourcesRefreshController,
  createTargetConfigurationRequestController,
  formatSourcePath,
  loadSources,
  notifyScopesChanged,
  renderResourceOverview,
  renderResources,
  renderSources,
  scopeLabel,
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
    expect(renderResources({ status: "ready", sources: [source], targets: [] }))
      .toContain('data-action="connect-target"');
  });

  it("uses Chinese resource copy and blue-gray primary actions in the overview", () => {
    const html = renderResources({
      status: "ready",
      sources: [source],
      scopes: [summary],
      targets: [],
    });

    expect(html).toContain('<p class="eyebrow">内容资源</p>');
    expect(html).not.toContain("EASYBLOG / SOURCES");
    expect(html).toContain('<main class="resource-overview-region" aria-label="资源详情">');
    expect(html).toContain('class="task-primary-button" data-action="add-source"');
    expect(html).toContain('class="task-primary-button" data-action="connect-target"');
    expect(renderResourceOverview({
      kind: "source",
      id: source.id,
      source,
      scopes: [summary],
    })).toContain('class="task-primary-button" data-action="edit-source"');
  });
});
