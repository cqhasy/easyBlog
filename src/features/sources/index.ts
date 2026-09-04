import { addSource, getSourceChildren, listScopes, listSources, saveScope, setScopeLifecycle } from "../../bridge/sources";
import { connectTarget, initializeTarget, inspectTargetConfiguration, listGithubRepositories, listTargets, previewTargetInitialization, refreshGithubRepositoryPermissions, saveTargetConfiguration } from "../../bridge/targets";
import type { AddSourceInput } from "../../bridge/sources";
import type { ConnectedTarget, GithubRepository, InitializationPreview, LayoutCandidate, SaveScopeInput, ScopeLifecycle, ScopeSummary, Source, SourceNodeRef, SourceTreeNode } from "../../contracts";

export const sourcesFeature = "sources";

export type SourcesApi = {
  listSources: () => Promise<Source[]>;
  addSource?: (input: AddSourceInput) => Promise<Source>;
  listScopes?: (sourceId?: string) => Promise<ScopeSummary[]>;
  saveScope?: (input: SaveScopeInput, expectedRevision?: number) => Promise<ScopeSummary>;
  setScopeLifecycle?: (scopeId: string, lifecycle: ScopeLifecycle, expectedRevision: number) => Promise<ScopeSummary>;
  getSourceChildren?: (sourceId: string, parent?: SourceNodeRef) => Promise<SourceTreeNode[]>;
  listTargets?: () => Promise<ConnectedTarget[]>;
  listGithubRepositories?: () => Promise<GithubRepository[]>;
  refreshGithubRepositoryPermissions?: () => Promise<GithubRepository[]>;
  connectTarget?: (input: GithubRepository) => Promise<ConnectedTarget>;
  inspectTargetConfiguration?: (targetId: string) => Promise<LayoutCandidate[]>;
  saveTargetConfiguration?: (input: { target_id: string; adapter: "github_pages" | "astro_content"; posts_directory: string; resources_directory: string }) => Promise<ConnectedTarget>;
  previewTargetInitialization?: (targetId: string) => Promise<InitializationPreview>;
  initializeTarget?: (targetId: string) => Promise<ConnectedTarget>;
};

export const defaultSourcesApi: SourcesApi = {
  listSources,
  addSource,
  listScopes,
  saveScope,
  setScopeLifecycle,
  getSourceChildren,
  listTargets,
  listGithubRepositories,
  refreshGithubRepositoryPermissions,
  connectTarget,
  inspectTargetConfiguration,
  saveTargetConfiguration,
  previewTargetInitialization,
  initializeTarget,
};

export type SourcesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; sources: Source[] }
  | { status: "error"; message: string };

export type ResourcesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; sources: Source[]; scopes?: ScopeSummary[]; targets: ConnectedTarget[] }
  | { status: "error"; message: string };

export type SourceResource =
  | { kind: "source"; id: string; source: Source; scopes: ScopeSummary[] }
  | { kind: "target"; id: string; target: ConnectedTarget; boundScopeCount: number };

export type SourcesNavigation = {
  openSourceEditor: (sourceId: string, scopeId?: string) => void;
  openTargetEditor: (targetId: string) => void;
};

type ResourceActionPanel = "add-source" | "connect-target" | undefined;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

export function formatSourcePath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}

export function scopeLabel(summary: ScopeSummary): string {
  if (summary.scope.lifecycle === "paused") return "已暂停";
  if (summary.health === "blocked") return "已阻塞";
  return summary.health === "needs_target" ? "待绑定目标" : "可用";
}

export async function loadSources(api: SourcesApi = defaultSourcesApi): Promise<SourcesState> {
  try {
    const sources = await api.listSources();
    return sources.length === 0 ? { status: "empty" } : { status: "ready", sources };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Sources could not be loaded") };
  }
}

export async function loadResources(api: SourcesApi = defaultSourcesApi): Promise<ResourcesState> {
  try {
    const [sources, scopes, targets] = await Promise.all([
      api.listSources(),
      api.listScopes?.() ?? Promise.resolve([]),
      api.listTargets?.() ?? Promise.resolve([]),
    ]);
    return sources.length === 0 && targets.length === 0
      ? { status: "empty" }
      : { status: "ready", sources, scopes, targets };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "来源资源无法加载") };
  }
}

export async function addSourceAndReload(
  api: Required<Pick<SourcesApi, "addSource" | "listSources">>,
  input: AddSourceInput,
): Promise<SourcesState> {
  await api.addSource(input);
  return loadSources(api);
}

export function notifyScopesChanged(onScopesChanged: () => void): void {
  onScopesChanged();
}

export function createSourcesRefreshController(
  api: SourcesApi,
  apply: (state: SourcesState) => void,
): { begin: () => number; isCurrent: (generation: number) => boolean; refresh: () => Promise<void> } {
  let generation = 0;
  const begin = () => ++generation;
  const isCurrent = (requestGeneration: number) => requestGeneration === generation;
  const refresh = async () => {
    const requestGeneration = begin();
    apply({ status: "loading" });
    const nextState = await loadSources(api);
    if (isCurrent(requestGeneration)) apply(nextState);
  };
  return { begin, isCurrent, refresh };
}

export function createRepositoryRefreshController(
  load: () => Promise<GithubRepository[]>,
  apply: (repositories: GithubRepository[]) => void,
): { refresh: () => Promise<void>; isLoading: () => boolean } {
  let loading = false;
  let generation = 0;
  const refresh = async () => {
    if (loading) return;
    const requestGeneration = ++generation;
    loading = true;
    try {
      const repositories = await load();
      if (requestGeneration === generation) apply(repositories);
    } finally {
      if (requestGeneration === generation) loading = false;
    }
  };
  return { refresh, isLoading: () => loading };
}

export function createTargetConfigurationRequestController() {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (requestGeneration: number) => requestGeneration === generation,
  };
}

export function resourcesFor(
  sources: Source[],
  scopes: ScopeSummary[],
  targets: ConnectedTarget[],
): SourceResource[] {
  return [
    ...sources.map((source) => ({
      kind: "source" as const,
      id: source.id,
      source,
      scopes: scopes.filter((summary) => summary.scope.source_id === source.id),
    })),
    ...targets.map((target) => ({
      kind: "target" as const,
      id: target.id,
      target,
      boundScopeCount: scopes.filter((summary) => summary.scope.target_id === target.id && summary.scope.lifecycle !== "deleted").length,
    })),
  ];
}

export function renderResourceOverview(resource: SourceResource): string {
  if (resource.kind === "source") {
    const scopeRows = resource.scopes.length
      ? `<ul class="resource-summary-list">${resource.scopes.map((summary) => `<li><span><strong>${escapeHtml(summary.scope.name)}</strong><small>${escapeHtml(scopeLabel(summary))}${summary.scope.target_id ? " · 已绑定发布目标" : " · 未绑定发布目标"}</small></span><button type="button" class="secondary-button" data-action="edit-source" data-source-id="${escapeHtml(resource.source.id)}" data-scope-id="${escapeHtml(summary.scope.id)}">编辑</button></li>`).join("")}</ul>`
      : '<p class="resource-empty">尚未创建同步范围。</p>';
    return `<section class="resource-overview" aria-labelledby="resource-title"><header><div><p class="eyebrow">内容来源</p><h2 id="resource-title">${escapeHtml(resource.source.name)}</h2><p>${escapeHtml(formatSourcePath(resource.source.path))}</p></div><details class="resource-overflow"><summary aria-label="更多操作">更多</summary><span>在编辑页管理范围状态。</span></details></header><dl class="resource-facts"><div><dt>来源类型</dt><dd>本地目录</dd></div><div><dt>同步范围</dt><dd>${resource.scopes.length} 个</dd></div></dl><section class="resource-summary"><div><h3>范围与绑定</h3><button type="button" data-action="edit-source" data-source-id="${escapeHtml(resource.source.id)}">新建范围</button></div>${scopeRows}</section></section>`;
  }

  const target = resource.target;
  const targetStatus = target.state === "ready"
    ? "可用"
    : target.state === "needs_configuration"
      ? "待配置"
      : target.state === "needs_reconnect"
        ? "需要重新连接"
        : "需要修复";
  return `<section class="resource-overview" aria-labelledby="resource-title"><header><div><p class="eyebrow">GitHub 目标</p><h2 id="resource-title">${escapeHtml(target.repository)}</h2><p>${escapeHtml(target.default_branch)} · ${target.visibility === "private" ? "私有仓库" : "公开仓库"}</p></div><details class="resource-overflow"><summary aria-label="更多操作">更多</summary><span>在编辑页检查发布配置。</span></details></header><dl class="resource-facts"><div><dt>状态</dt><dd>${targetStatus}</dd></div><div><dt>已绑定范围</dt><dd>${resource.boundScopeCount} 个</dd></div></dl><section class="resource-summary"><div><h3>发布配置</h3><button type="button" data-action="edit-target" data-target-id="${escapeHtml(target.id)}">编辑</button></div><p class="resource-note">${target.adapter === "astro_content" ? "Astro 内容集合" : target.adapter === "github_pages" ? "GitHub Pages" : "尚未选择发布适配器"}</p></section></section>`;
}

function renderResourceList(resources: SourceResource[], selectedResourceId?: string): string {
  const sourceItems = resources.filter((resource) => resource.kind === "source");
  const targetItems = resources.filter((resource) => resource.kind === "target");
  const renderItem = (resource: SourceResource) => {
    const selected = resource.id === selectedResourceId;
    const name = resource.kind === "source" ? resource.source.name : resource.target.repository;
    const detail = resource.kind === "source" ? `${resource.scopes.length} 个范围` : `${resource.boundScopeCount} 个绑定`;
    return `<li><button type="button" data-action="select-resource" data-resource-id="${escapeHtml(resource.id)}" ${selected ? 'aria-current="true"' : ""}><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span></button></li>`;
  };
  return `<nav class="resource-list-nav" aria-label="来源与目标资源"><section><h2>内容来源</h2>${sourceItems.length ? `<ul>${sourceItems.map(renderItem).join("")}</ul>` : '<p>尚未添加来源</p>'}</section><section><h2>GitHub 目标</h2>${targetItems.length ? `<ul>${targetItems.map(renderItem).join("")}</ul>` : '<p>尚未连接目标</p>'}</section></nav>`;
}

function renderActionPanel(
  panel: ResourceActionPanel,
  repositories: GithubRepository[],
  selectedRepository: string,
  message: string,
  loadingRepositories: boolean,
): string {
  if (panel === "add-source") {
    return `<section class="resource-action-panel" aria-label="添加内容来源"><header><h2>添加内容来源</h2><button type="button" class="icon-button" data-action="close-resource-action" aria-label="关闭" title="关闭">×</button></header><form id="add-source-form" class="resource-inline-form"><label>目录路径<input name="path" required placeholder="例如：C:\\Users\\you\\Documents\\blog" /></label><label>显示名称<span class="optional">可选</span><input name="name" placeholder="留空使用目录名" /></label><button type="submit">添加</button></form>${message ? `<p class="resource-message" role="status">${escapeHtml(message)}</p>` : ""}</section>`;
  }
  if (panel === "connect-target") {
    const options = repositories.length
      ? repositories.map((repository) => `<option value="${escapeHtml(repository.repository)}" ${repository.repository === selectedRepository ? "selected" : ""}>${escapeHtml(repository.repository)} · ${repository.visibility === "private" ? "私有" : "公开"} · ${escapeHtml(repository.default_branch)}</option>`).join("")
      : '<option value="">没有可连接的仓库</option>';
    return `<section class="resource-action-panel" aria-label="连接 GitHub 目标"><header><h2>连接 GitHub 目标</h2><button type="button" class="icon-button" data-action="close-resource-action" aria-label="关闭" title="关闭">×</button></header><form id="connect-target-form" class="resource-inline-form"><label>仓库<select name="repository" ${loadingRepositories ? "disabled" : ""}>${options}</select></label><button type="button" class="secondary-button" data-action="refresh-repositories" ${loadingRepositories ? "disabled" : ""}>${loadingRepositories ? "正在加载..." : "重新加载"}</button><button type="submit" ${selectedRepository ? "" : "disabled"}>连接</button></form>${message ? `<p class="resource-message" role="status">${escapeHtml(message)}</p>` : ""}</section>`;
  }
  return "";
}

export function renderResources(
  state: ResourcesState,
  selectedResourceId?: string,
  panel: ResourceActionPanel = undefined,
  repositories: GithubRepository[] = [],
  selectedRepository = "",
  message = "",
  loadingRepositories = false,
): string {
  const actionPanel = renderActionPanel(panel, repositories, selectedRepository, message, loadingRepositories);
  if (state.status === "loading") {
    return `<section class="sources-page resource-page"><header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1>内容来源</h1><p class="sources-subtitle">管理内容来源与 GitHub 发布目标。</p></div></header><p class="sources-status" role="status">正在加载资源...</p></section>`;
  }
  if (state.status === "error") {
    return `<section class="sources-page resource-page"><header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1>内容来源</h1><p class="sources-subtitle">管理内容来源与 GitHub 发布目标。</p></div></header><div class="sources-error" role="alert"><strong>资源加载失败</strong><span>${escapeHtml(state.message)}</span><button type="button" data-action="retry">重试</button></div></section>`;
  }
  const resources = resourcesFor(
    state.status === "ready" ? state.sources : [],
    state.status === "ready" ? state.scopes ?? [] : [],
    state.status === "ready" ? state.targets : [],
  );
  const selected = resources.find((resource) => resource.id === selectedResourceId) ?? resources[0];
  const empty = resources.length === 0;
  return `<section class="sources-page resource-page" aria-labelledby="sources-title"><header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">管理内容来源、同步范围和 GitHub 发布目标。</p></div></header><section class="resource-actions" aria-label="资源操作"><button type="button" data-action="add-source">添加内容来源</button><button type="button" class="secondary-button" data-action="connect-target">连接 GitHub 目标</button></section>${actionPanel}<div class="resource-layout">${renderResourceList(resources, selected?.id)}<main class="resource-overview-region">${empty ? '<section class="resource-empty-state"><h2>从一个内容来源开始</h2><p>添加本地目录后，再创建同步范围并连接发布目标。</p></section>' : selected ? renderResourceOverview(selected) : ""}</main></div></section>`;
}

export function renderSources(state: SourcesState): string {
  if (state.status === "loading") return '<p class="sources-status" role="status">正在加载来源...</p>';
  if (state.status === "error") return `<div class="sources-error" role="alert"><strong>来源加载失败</strong><span>${escapeHtml(state.message)}</span></div>`;
  if (state.status === "empty") return '<p class="sources-status sources-empty">尚未添加本地目录</p>';
  return `<ul class="source-list">${state.sources.map((source) => `<li><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(formatSourcePath(source.path))}</span></div></li>`).join("")}</ul>`;
}

export function mountSources(
  root: HTMLElement,
  api: SourcesApi = defaultSourcesApi,
  navigation: SourcesNavigation = { openSourceEditor: () => undefined, openTargetEditor: () => undefined },
  initialResourceId?: string,
): void {
  let state: ResourcesState = { status: "loading" };
  let selectedResourceId = initialResourceId;
  let panel: ResourceActionPanel;
  let repositories: GithubRepository[] = [];
  let selectedRepository = "";
  let message = "";
  let loadingRepositories = false;
  let generation = 0;
  const render = () => {
    root.innerHTML = renderResources(state, selectedResourceId, panel, repositories, selectedRepository, message, loadingRepositories);
  };
  const refresh = async () => {
    const requestGeneration = ++generation;
    state = { status: "loading" };
    render();
    const nextState = await loadResources(api);
    if (requestGeneration !== generation) return;
    state = nextState;
    render();
  };
  const refreshRepositories = async () => {
    if (loadingRepositories) return;
    loadingRepositories = true;
    message = "正在加载可连接的 GitHub 仓库...";
    render();
    try {
      repositories = await (api.refreshGithubRepositoryPermissions?.() ?? api.listGithubRepositories?.() ?? Promise.resolve([]));
      selectedRepository = repositories.some((repository) => repository.repository === selectedRepository)
        ? selectedRepository
        : repositories[0]?.repository ?? "";
      message = repositories.length ? "已加载可连接的 GitHub 仓库。" : "没有发现可连接的 GitHub 仓库。";
    } catch (error) {
      message = errorMessage(error, "GitHub 仓库无法加载");
    } finally {
      loadingRepositories = false;
      render();
    }
  };
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "add-source-form" && api.addSource) {
      event.preventDefault();
      const data = new FormData(form);
      message = "正在添加内容来源...";
      render();
      void api.addSource({
        path: String(data.get("path") ?? ""),
        name: String(data.get("name") ?? "") || undefined,
      }).then((source) => {
        selectedResourceId = source.id;
        panel = undefined;
        message = "";
        return refresh();
      }).catch((error) => {
        message = errorMessage(error, "内容来源无法添加");
        render();
      });
      return;
    }
    if (form.id === "connect-target-form" && api.connectTarget) {
      event.preventDefault();
      const repository = repositories.find((item) => item.repository === selectedRepository);
      if (!repository) return;
      message = `正在连接 ${repository.repository}...`;
      render();
      void api.connectTarget(repository).then((target) => {
        navigation.openTargetEditor(target.id);
      }).catch((error) => {
        message = errorMessage(error, "GitHub 目标无法连接");
        render();
      });
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.name === "repository") selectedRepository = input.value;
  });
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "retry") {
      void refresh();
      return;
    }
    if (action === "select-resource") {
      selectedResourceId = target.dataset.resourceId;
      render();
      return;
    }
    if (action === "add-source") {
      panel = "add-source";
      message = "";
      render();
      return;
    }
    if (action === "connect-target") {
      panel = "connect-target";
      message = "";
      render();
      void refreshRepositories();
      return;
    }
    if (action === "close-resource-action") {
      panel = undefined;
      message = "";
      render();
      return;
    }
    if (action === "refresh-repositories") {
      void refreshRepositories();
      return;
    }
    if (action === "edit-source" && target.dataset.sourceId) {
      navigation.openSourceEditor(target.dataset.sourceId, target.dataset.scopeId);
      return;
    }
    if (action === "edit-target" && target.dataset.targetId) {
      navigation.openTargetEditor(target.dataset.targetId);
    }
  });
  render();
  void refresh();
}
