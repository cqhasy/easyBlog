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
  | { status: "ready"; sources: Source[]; scopes: ScopeSummary[]; targets: ConnectedTarget[] }
  | { status: "error"; message: string };

export type ResourceCategory = "sources" | "targets";

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

export function sourceStatusLabel(scopes: ScopeSummary[]): string {
  const visibleScopes = scopes.filter((summary) => summary.scope.lifecycle !== "deleted");
  if (!visibleScopes.length) return "未配置";
  if (visibleScopes.some((summary) => summary.health === "blocked")) return "已阻塞";
  if (visibleScopes.every((summary) => summary.scope.lifecycle === "paused")) return "已暂停";
  if (visibleScopes.some((summary) => summary.health === "needs_target")) return "待绑定目标";
  return "可用";
}

export function targetStatusLabel(target: ConnectedTarget): string {
  if (target.state === "ready") return "可用";
  if (target.state === "needs_configuration") return "待配置";
  if (target.state === "needs_reconnect") return "需要重新连接";
  return "需要修复";
}

function resourceStateClass(label: string): string {
  return ({
    可用: "ready",
    未配置: "unconfigured",
    待配置: "unconfigured",
    待绑定目标: "needs-target",
    已暂停: "paused",
    已阻塞: "blocked",
    需要重新连接: "blocked",
    需要修复: "blocked",
  } as Record<string, string>)[label] ?? "unconfigured";
}

function formatResourceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function latestScopeUpdate(scopes: ScopeSummary[]): string {
  const latest = scopes
    .filter((summary) => summary.scope.lifecycle !== "deleted")
    .map((summary) => summary.scope.updated_at)
    .sort()
    .at(-1);
  return latest ? formatResourceTime(latest) : "尚未配置";
}

function scopeSelectionSummary(summary: ScopeSummary): string {
  const selections = summary.scope.selections;
  if (!selections.length) return "未选择内容范围";
  if (selections.length === 1) return `包含 ${selections[0].display_name}`;
  return `包含 ${selections.length} 个内容范围`;
}

export async function loadSources(api: SourcesApi = defaultSourcesApi): Promise<SourcesState> {
  try {
    const sources = await api.listSources();
    return sources.length === 0 ? { status: "empty" } : { status: "ready", sources };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "来源无法加载") };
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

export function resourcesForCategory(resources: SourceResource[], category: ResourceCategory): SourceResource[] {
  return resources.filter((resource) => resource.kind === (category === "sources" ? "source" : "target"));
}

function renderScopeRows(
  resource: Extract<SourceResource, { kind: "source" }>,
  targets: ConnectedTarget[],
): string {
  const visibleScopes = resource.scopes.filter((summary) => summary.scope.lifecycle !== "deleted");
  if (!visibleScopes.length) return '<p class="resource-empty">尚未创建同步范围。</p>';
  return `<ul class="resource-summary-list">${visibleScopes.map((summary) => {
    const target = targets.find((item) => item.id === summary.scope.target_id);
    const state = scopeLabel(summary);
    return `<li><div class="resource-scope-main"><strong>${escapeHtml(summary.scope.name)}</strong><small>${escapeHtml(scopeSelectionSummary(summary))}</small></div><div class="resource-scope-destination"><span class="resource-scope-target">${target ? `<i data-lucide="arrow-right"></i>${escapeHtml(target.repository)}` : "尚未绑定目标"}</span><span class="resource-scope-state scope-state-${resourceStateClass(state)}">${escapeHtml(state)}</span></div><button type="button" class="icon-button resource-edit-button" data-action="edit-source" data-source-id="${escapeHtml(resource.source.id)}" data-scope-id="${escapeHtml(summary.scope.id)}" aria-label="编辑 ${escapeHtml(summary.scope.name)}" title="编辑 ${escapeHtml(summary.scope.name)}"><i data-lucide="pencil"></i></button></li>`;
  }).join("")}</ul>`;
}

function renderSourceOverview(
  resource: Extract<SourceResource, { kind: "source" }>,
  targets: ConnectedTarget[],
): string {
  const visibleScopes = resource.scopes.filter((summary) => summary.scope.lifecycle !== "deleted");
  const state = sourceStatusLabel(resource.scopes);
  return `<section class="resource-overview" aria-labelledby="resource-title"><header class="resource-overview-header"><div class="resource-overview-heading"><p class="eyebrow">内容来源</p><h2 id="resource-title">${escapeHtml(resource.source.name)}</h2><p>${escapeHtml(formatSourcePath(resource.source.path))} · 本地目录</p></div><div class="resource-overview-actions"><button type="button" class="secondary-button resource-edit-source-button" data-action="edit-source" data-source-id="${escapeHtml(resource.source.id)}"><i data-lucide="pencil"></i><span>编辑来源</span></button></div></header><dl class="resource-facts resource-facts-source"><div><dt>来源类型</dt><dd>本地目录</dd></div><div><dt>最近更新</dt><dd>${escapeHtml(latestScopeUpdate(resource.scopes))}</dd></div><div><dt>同步状态</dt><dd><span class="resource-fact-status fact-state-${resourceStateClass(state)}">${escapeHtml(state)}</span></dd></div></dl><section class="resource-summary"><div class="resource-section-heading"><div><h3>同步范围</h3><p>${visibleScopes.length} 个范围</p></div><button type="button" class="text-action" data-action="edit-source" data-source-id="${escapeHtml(resource.source.id)}">管理全部<i data-lucide="arrow-right"></i></button></div>${renderScopeRows(resource, targets)}</section></section>`;
}

function renderTargetOverview(resource: Extract<SourceResource, { kind: "target" }>): string {
  const target = resource.target;
  return `<section class="resource-overview" aria-labelledby="resource-title"><header class="resource-overview-header"><div class="resource-overview-heading"><p class="eyebrow">发布目标</p><h2 id="resource-title">${escapeHtml(target.repository)}</h2><p>${escapeHtml(target.default_branch)} · ${target.visibility === "private" ? "私有仓库" : "公开仓库"}</p></div><div class="resource-overview-actions"><button type="button" class="secondary-button resource-new-scope-button" data-action="edit-target" data-target-id="${escapeHtml(target.id)}">编辑目标</button></div></header><dl class="resource-facts"><div><dt>目标类型</dt><dd>GitHub 仓库</dd></div><div><dt>默认分支</dt><dd>${escapeHtml(target.default_branch)}</dd></div></dl><section class="resource-summary"><div class="resource-section-heading"><h3>发布配置</h3></div><p class="resource-note">${target.adapter === "astro_content" ? "Astro 内容集合" : target.adapter === "github_pages" ? "GitHub Pages" : "尚未选择发布适配器"}</p></section></section>`;
}

export function renderResourceOverview(resource: SourceResource, targets: ConnectedTarget[] = []): string {
  if (resource.kind === "source") {
    return renderSourceOverview(resource, targets);
  }
  return renderTargetOverview(resource);
}

function renderResourceTabs(resources: SourceResource[], category: ResourceCategory): string {
  return `<div class="resource-tabs" role="tablist" aria-label="资源类型"><button type="button" role="tab" aria-selected="${category === "sources" ? "true" : "false"}" data-action="select-category" data-category="sources">内容来源</button><button type="button" role="tab" aria-selected="${category === "targets" ? "true" : "false"}" data-action="select-category" data-category="targets">发布目标</button></div>`;
}

function renderResourceList(resources: SourceResource[], category: ResourceCategory, selectedResourceId?: string): string {
  const items = resourcesForCategory(resources, category);
  const renderItem = (resource: SourceResource) => {
    const selected = resource.id === selectedResourceId;
    if (resource.kind === "source") {
      const visibleScopes = resource.scopes.filter((summary) => summary.scope.lifecycle !== "deleted");
      const state = sourceStatusLabel(resource.scopes);
      return `<li><button type="button" class="resource-list-row" data-action="select-resource" data-resource-id="${escapeHtml(resource.id)}" ${selected ? 'aria-current="true"' : ""}><span class="resource-list-icon" aria-hidden="true"><i data-lucide="folder-open"></i></span><strong class="resource-list-name">${escapeHtml(resource.source.name)}</strong><span class="resource-list-state source-state-${resourceStateClass(state)}">${escapeHtml(state)}</span><span class="resource-list-meta">本地目录 · ${visibleScopes.length} 个同步范围</span><span class="resource-list-path">${escapeHtml(formatSourcePath(resource.source.path))}</span></button></li>`;
    }
    const state = targetStatusLabel(resource.target);
    return `<li><button type="button" class="resource-list-row" data-action="select-resource" data-resource-id="${escapeHtml(resource.id)}" ${selected ? 'aria-current="true"' : ""}><span class="resource-list-icon resource-list-icon-target" aria-hidden="true"><i data-lucide="git-branch"></i></span><strong class="resource-list-name">${escapeHtml(resource.target.repository)}</strong><span class="resource-list-state target-state-${resourceStateClass(state)}">${escapeHtml(state)}</span><span class="resource-list-meta">GitHub · ${resource.boundScopeCount} 个同步范围</span><span class="resource-list-path">${escapeHtml(resource.target.default_branch)} · ${resource.target.visibility === "private" ? "私有仓库" : "公开仓库"}</span></button></li>`;
  };
  const emptyMessage = category === "sources" ? "尚未添加内容来源" : "尚未连接发布目标";
  const heading = category === "sources" ? "内容来源" : "发布目标";
  return `<nav class="resource-list-nav" aria-label="${heading}列表"><section><div class="resource-list-heading"><h2>${heading}</h2></div>${items.length ? `<ul>${items.map(renderItem).join("")}</ul>` : `<p class="resource-list-empty">${emptyMessage}</p>`}</section></nav>`;
}

function renderActionDialog(
  panel: ResourceActionPanel,
  repositories: GithubRepository[],
  selectedRepository: string,
  message: string,
  loadingRepositories: boolean,
): string {
  if (panel === "add-source") {
    return `<dialog class="resource-action-dialog" data-resource-action-dialog aria-labelledby="add-source-title"><form id="add-source-form" class="resource-dialog-form"><header class="resource-dialog-header"><span class="resource-dialog-icon" aria-hidden="true"><i data-lucide="folder-plus"></i></span><div><p class="eyebrow">内容来源</p><h2 id="add-source-title">添加内容来源</h2></div><button type="button" class="icon-button resource-dialog-close" data-action="close-resource-action" aria-label="关闭添加内容来源" title="关闭"><i data-lucide="x"></i></button></header><div class="resource-dialog-body"><label class="resource-dialog-field"><span>目录路径</span><input name="path" required autocomplete="off" placeholder="例如：C:\\Users\\you\\Documents\\blog…" /></label><label class="resource-dialog-field"><span>显示名称 <small>可选</small></span><input name="name" autocomplete="off" placeholder="留空时使用目录名…" /></label>${message ? `<p class="resource-message" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ""}</div><footer class="resource-dialog-actions"><button type="button" class="secondary-button" data-action="close-resource-action">取消</button><button type="submit" class="task-primary-button"><i data-lucide="plus"></i><span>添加来源</span></button></footer></form></dialog>`;
  }
  if (panel === "connect-target") {
    const options = repositories.length
      ? repositories.map((repository) => `<option value="${escapeHtml(repository.repository)}" ${repository.repository === selectedRepository ? "selected" : ""}>${escapeHtml(repository.repository)} · ${repository.visibility === "private" ? "私有" : "公开"} · ${escapeHtml(repository.default_branch)}</option>`).join("")
      : '<option value="">没有可连接的仓库</option>';
    return `<dialog class="resource-action-dialog" data-resource-action-dialog aria-labelledby="connect-target-title"><form id="connect-target-form" class="resource-dialog-form"><header class="resource-dialog-header"><span class="resource-dialog-icon resource-dialog-icon-target" aria-hidden="true"><i data-lucide="git-branch"></i></span><div><p class="eyebrow">发布目标</p><h2 id="connect-target-title">连接 GitHub 目标</h2></div><button type="button" class="icon-button resource-dialog-close" data-action="close-resource-action" aria-label="关闭连接 GitHub 目标" title="关闭"><i data-lucide="x"></i></button></header><div class="resource-dialog-body"><div class="resource-dialog-field"><div class="resource-dialog-field-header"><label for="target-repository">GitHub 仓库</label><button type="button" class="icon-button resource-repository-refresh" data-action="refresh-repositories" ${loadingRepositories ? "disabled" : ""} aria-label="刷新可连接的 GitHub 仓库" title="刷新仓库"><i data-lucide="refresh-cw"></i></button></div><select id="target-repository" name="repository" ${loadingRepositories ? "disabled" : ""}>${options}</select></div>${message ? `<p class="resource-message" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ""}</div><footer class="resource-dialog-actions"><button type="button" class="secondary-button" data-action="close-resource-action">取消</button><button type="submit" class="task-primary-button" ${selectedRepository ? "" : "disabled"}><i data-lucide="link"></i><span>连接目标</span></button></footer></form></dialog>`;
  }
  return "";
}

function renderResourcesHeader(): string {
  return `<header class="workspace-header resource-intro"><div><p class="eyebrow">内容资源</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">管理内容来源、同步范围和 GitHub 发布目标。</p></div><div class="resource-header-actions"><button type="button" class="task-primary-button resource-add-button" data-action="add-source">添加内容来源</button><button type="button" class="secondary-button resource-connect-button" data-action="connect-target">连接 GitHub 目标</button></div></header>`;
}

function renderResourcesPage(content: string): string {
  return `<section class="sources-page resource-page" aria-labelledby="sources-title">${renderResourcesHeader()}${content}</section>`;
}

export function renderResources(
  state: ResourcesState,
  category: ResourceCategory = "sources",
  selectedResourceId?: string,
  panel: ResourceActionPanel = undefined,
  repositories: GithubRepository[] = [],
  selectedRepository = "",
  message = "",
  loadingRepositories = false,
): string {
  const actionDialog = renderActionDialog(panel, repositories, selectedRepository, message, loadingRepositories);
  if (state.status === "loading") {
    return renderResourcesPage(`<p class="sources-status" role="status">正在加载资源…</p>${actionDialog}`);
  }
  if (state.status === "error") {
    return renderResourcesPage(`<div class="sources-error" role="alert"><strong>资源加载失败</strong><span>${escapeHtml(state.message)}</span><button type="button" data-action="retry">重试</button></div>${actionDialog}`);
  }
  if (state.status === "empty") {
    return renderResourcesPage(`<section class="resource-empty-state"><h2>从一个内容来源开始</h2><p>添加本地目录后，再创建同步范围并连接发布目标。</p></section>${actionDialog}`);
  }
  const resources = resourcesFor(state.sources, state.scopes, state.targets);
  const categoryResources = resourcesForCategory(resources, category);
  const selected = categoryResources.find((resource) => resource.id === selectedResourceId) ?? categoryResources[0];
  const empty = categoryResources.length === 0;
  const emptyDetail = category === "sources"
    ? '<section class="resource-empty-state"><h2>还没有内容来源</h2><p>添加本地目录后，再创建同步范围。</p><button type="button" class="task-primary-button" data-action="add-source">添加来源</button></section>'
    : '<section class="resource-empty-state"><h2>还没有发布目标</h2><p>连接 GitHub 仓库后，可将同步范围发布到目标。</p><button type="button" class="secondary-button" data-action="connect-target">连接发布目标</button></section>';
  return renderResourcesPage(`${state.status === "ready" ? renderResourceTabs(resources, category) : ""}<div class="resource-layout">${renderResourceList(resources, category, selected?.id)}<section class="resource-overview-region" aria-label="资源详情">${empty ? emptyDetail : selected ? renderResourceOverview(selected, state.targets) : ""}</section></div>${actionDialog}`);
}

export function renderSources(state: SourcesState): string {
  if (state.status === "loading") return '<p class="sources-status" role="status">正在加载来源…</p>';
  if (state.status === "error") return `<div class="sources-error" role="alert"><strong>来源加载失败</strong><span>${escapeHtml(state.message)}</span></div>`;
  if (state.status === "empty") return '<p class="sources-status sources-empty">尚未添加本地目录</p>';
  return `<ul class="source-list">${state.sources.map((source) => `<li><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(formatSourcePath(source.path))}</span></div></li>`).join("")}</ul>`;
}

export function mountSources(
  root: HTMLElement,
  api: SourcesApi = defaultSourcesApi,
  navigation: SourcesNavigation = { openSourceEditor: () => undefined, openTargetEditor: () => undefined },
  initialResourceId?: string,
  isActive: () => boolean = () => true,
  hydrate: () => void = () => undefined,
): void {
  let state: ResourcesState = { status: "loading" };
  let selectedResourceId = initialResourceId;
  let panel: ResourceActionPanel;
  let repositories: GithubRepository[] = [];
  let selectedRepository = "";
  let message = "";
  let loadingRepositories = false;
  let generation = 0;
  let category: ResourceCategory = "sources";
  let initialCategoryResolved = false;
  const resources = () => state.status === "ready"
    ? resourcesFor(state.sources, state.scopes, state.targets)
    : [];
  const categoryResources = () => resourcesForCategory(resources(), category);
  const normalizeSelection = () => {
    const available = categoryResources();
    if (!available.some((resource) => resource.id === selectedResourceId)) {
      selectedResourceId = available[0]?.id;
    }
  };
  const render = () => {
    if (!isActive()) return;
    root.innerHTML = renderResources(state, category, selectedResourceId, panel, repositories, selectedRepository, message, loadingRepositories);
    hydrate();
    const dialog = root.querySelector?.("[data-resource-action-dialog]") as HTMLDialogElement | null | undefined;
    dialog?.addEventListener("cancel", (event) => {
      event.preventDefault();
      panel = undefined;
      message = "";
      render();
    });
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
    }
  };
  const selectCategory = (nextCategory: ResourceCategory) => {
    category = nextCategory;
    normalizeSelection();
    render();
  };
  const refresh = async () => {
    const requestGeneration = ++generation;
    state = { status: "loading" };
    render();
    const nextState = await loadResources(api);
    if (!isActive() || requestGeneration !== generation) return;
    state = nextState;
    if (state.status === "ready") {
      if (!initialCategoryResolved) {
        category = initialResourceId && state.targets.some((target) => target.id === initialResourceId)
          ? "targets"
          : "sources";
        initialCategoryResolved = true;
      }
      normalizeSelection();
    }
    render();
  };
  const refreshRepositories = async () => {
    if (!isActive() || loadingRepositories) return;
    loadingRepositories = true;
    message = "正在加载可连接的 GitHub 仓库…";
    render();
    try {
      repositories = await (api.refreshGithubRepositoryPermissions?.() ?? api.listGithubRepositories?.() ?? Promise.resolve([]));
      selectedRepository = repositories.some((repository) => repository.repository === selectedRepository)
        ? selectedRepository
        : repositories[0]?.repository ?? "";
      message = repositories.length ? "已加载可连接的 GitHub 仓库。" : "没有发现可连接的 GitHub 仓库。";
    } catch (error) {
      if (!isActive()) return;
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
      message = "正在添加内容来源…";
      render();
      void api.addSource({
        path: String(data.get("path") ?? ""),
        name: String(data.get("name") ?? "") || undefined,
      }).then((source) => {
        if (!isActive()) return;
        category = "sources";
        selectedResourceId = source.id;
        panel = undefined;
        message = "";
        return refresh();
      }).catch((error) => {
        if (!isActive()) return;
        message = errorMessage(error, "内容来源无法添加");
        render();
      });
      return;
    }
    if (form.id === "connect-target-form" && api.connectTarget) {
      event.preventDefault();
      const repository = repositories.find((item) => item.repository === selectedRepository);
      if (!repository) return;
      message = `正在连接 ${repository.repository}…`;
      render();
      void api.connectTarget(repository).then((target) => {
        if (!isActive()) return;
        navigation.openTargetEditor(target.id);
      }).catch((error) => {
        if (!isActive()) return;
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
      if (target.dataset.resourceId && categoryResources().some((resource) => resource.id === target.dataset.resourceId)) {
        selectedResourceId = target.dataset.resourceId;
      }
      render();
      return;
    }
    if (action === "select-category") {
      const nextCategory = target.dataset.category;
      if (nextCategory === "sources" || nextCategory === "targets") {
        selectCategory(nextCategory);
      }
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
