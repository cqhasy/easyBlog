import { addSource, getSourceChildren, listScopes, listSources, saveScope, setScopeLifecycle } from "../../bridge/sources";
import { connectTarget, initializeTarget, inspectTargetConfiguration, listGithubRepositories, listTargets, previewTargetInitialization, refreshGithubRepositoryPermissions, saveTargetConfiguration } from "../../bridge/targets";
import type { AddSourceInput } from "../../bridge/sources";
import type { ConnectedTarget, GithubRepository, InitializationPreview, LayoutCandidate, SaveScopeInput, Scope, ScopeLifecycle, ScopeSelection, ScopeSummary, Source, SourceNodeRef, SourceTreeNode } from "../../contracts";

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

export type SourcesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; sources: Source[] }
  | { status: "error"; message: string };

type TargetConfigurationForm = {
  adapter: "github_pages" | "astro_content";
  postsDirectory: string;
  resourcesDirectory: string;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function loadSources(api: SourcesApi = { listSources }): Promise<SourcesState> {
  try {
    const sources = await api.listSources();
    return sources.length === 0 ? { status: "empty" } : { status: "ready", sources };
  } catch (error) {
    return {
      status: "error",
      message: errorMessage(error, "Sources could not be loaded"),
    };
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

export function formatSourcePath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}

export function renderSources(state: SourcesState): string {
  const content =
    state.status === "loading"
      ? '<p class="sources-status" role="status">正在加载来源...</p>'
      : state.status === "error"
        ? `<div class="sources-error" role="alert"><strong>来源加载失败</strong><span>${escapeHtml(state.message)}</span><button type="button" data-action="retry">重试</button></div>`
        : state.status === "empty"
          ? '<p class="sources-status sources-empty">尚未添加本地目录</p>'
          : `<ul class="source-list">${state.sources
              .map(
                (source) =>
                  `<li><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(formatSourcePath(source.path))}</span></div><time datetime="${escapeHtml(source.created_at)}">${escapeHtml(source.created_at)}</time></li>`,
              )
              .join("")}</ul>`;

  return `<section class="sources-page sources-standalone" aria-labelledby="sources-title">
    <header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">从本地目录中整理需要同步的 Markdown 内容。</p></div></header>
    <form class="source-form" id="add-source-form"><label>目录路径<input name="path" required placeholder="例如：C:\\Users\\you\\Documents\\blog" /></label><label>显示名称<span class="optional">可选</span><input name="name" placeholder="留空使用目录名" /></label><button type="submit">添加目录</button></form>
    <div class="sources-content">${content}</div>
  </section>`;
}

type EditorState = {
  source: Source;
  scope?: Scope;
  selections: ScopeSelection[];
  includePatterns: string[];
  excludePatterns: string[];
  children: Record<string, SourceTreeNode[]>;
  expanded: Set<string>;
  loading: Set<string>;
  lifecyclePending: boolean;
  error?: string;
};

function selectionKey(reference: SourceNodeRef): string { return `${reference.kind}:${reference.value}`; }
function editorFor(source: Source, scope?: Scope): EditorState {
  return { source, scope, selections: scope?.selections ?? [], includePatterns: scope?.include_patterns ?? [], excludePatterns: scope?.exclude_patterns ?? [], children: {}, expanded: new Set(), loading: new Set(), lifecyclePending: false };
}
export function scopeLabel(summary: ScopeSummary): string {
  if (summary.scope.lifecycle === "paused") return "已暂停";
  if (summary.health === "blocked") return "已阻塞";
  return summary.health === "needs_target" ? "待绑定目标" : "可用";
}
function renderScopeList(source: Source, summaries: ScopeSummary[]): string {
  const items = summaries.filter(({ scope }) => scope.source_id === source.id).map(({ scope, ...summary }) => `<li><button class="scope-entry" type="button" data-action="edit-scope" data-source-id="${escapeHtml(source.id)}" data-scope-id="${escapeHtml(scope.id)}"><span>${escapeHtml(scope.name)}</span><small>${escapeHtml(scopeLabel({ scope, ...summary }))}</small></button></li>`).join("");
  return `<section class="source-group"><div class="source-group-heading"><div class="source-identity"><span class="source-mark" aria-hidden="true">/</span><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(formatSourcePath(source.path))}</span></div></div><button class="new-scope-button" type="button" data-action="new-scope" data-source-id="${escapeHtml(source.id)}" aria-label="为 ${escapeHtml(source.name)} 新建范围" title="新建范围">+</button></div>${items ? `<ul class="scope-list">${items}</ul>` : '<p class="scope-empty">还没有同步范围</p>'}</section>`;
}
function renderTree(editor: EditorState, parent = ".", depth = 0): string {
  const nodes = editor.children[parent];
  if (editor.loading.has(parent)) return '<p class="tree-status">正在读取目录...</p>';
  if (!nodes) return depth === 0 ? '<p class="tree-status">展开以选择来源内容。</p>' : "";
  return `<ul class="tree-list">${nodes.map((node) => { const key = selectionKey(node.reference); const selected = editor.selections.some((selection) => selectionKey(selection.node) === key); const expanded = editor.expanded.has(node.reference.value); const subtree = node.kind === "directory" && expanded ? renderTree(editor, node.reference.value, depth + 1) : ""; return `<li><div class="tree-node" style="--depth:${depth}">${node.kind === "directory" ? `<button class="tree-toggle" type="button" data-action="toggle-tree" data-path="${escapeHtml(node.reference.value)}" aria-label="展开 ${escapeHtml(node.display_name)}">${expanded ? "-" : "+"}</button>` : '<span class="tree-spacer"></span>'}<label><input type="checkbox" data-action="toggle-selection" data-path="${escapeHtml(node.reference.value)}" data-name="${escapeHtml(node.display_name)}" ${selected ? "checked" : ""} />${escapeHtml(node.display_name)}</label>${selected && node.kind === "directory" ? `<label class="recursive-toggle"><input type="checkbox" data-action="toggle-recursive" data-path="${escapeHtml(node.reference.value)}" ${editor.selections.find((selection) => selectionKey(selection.node) === key)?.recursive ? "checked" : ""} />包含子目录</label>` : ""}</div>${subtree}</li>`; }).join("")}</ul>`;
}
function renderRuleRows(kind: "include" | "exclude", patterns: string[]): string {
  const rows = patterns.map((pattern, index) => `<div class="rule-row"><input data-rule-kind="${kind}" data-rule-index="${index}" value="${escapeHtml(pattern)}" placeholder="例如：posts/**/*.md" /><button type="button" class="icon-button" aria-label="删除规则" data-action="remove-rule" data-rule-kind="${kind}" data-rule-index="${index}">x</button></div>`).join("");
  return `<div class="rule-list">${rows}<button class="add-rule-button" type="button" data-action="add-rule" data-rule-kind="${kind}">+ 添加规则</button></div>`;
}
function renderEditor(editor: EditorState | undefined, targets: ConnectedTarget[]): string {
  if (!editor) return '<aside class="scope-editor scope-editor-empty"><div><span class="empty-mark" aria-hidden="true">+</span><h2>选择一个同步范围</h2><p>从左侧选择已有范围，或为来源新建一个范围。</p></div></aside>';
  const scope = editor.scope;
  const lifecycleDisabled = editor.lifecyclePending ? "disabled" : "";
  const lifecycleLabel = editor.lifecyclePending ? "正在更新..." : scope?.lifecycle === "paused" ? "恢复" : "暂停";
  const targetOptions = [`<option value="">暂不绑定</option>`, ...targets.map((target) => `<option value="${escapeHtml(target.id)}" ${target.state !== "ready" ? "disabled" : ""} ${scope?.target_id === target.id ? "selected" : ""}>${escapeHtml(target.repository)}${target.state === "needs_configuration" ? "（待配置）" : target.state !== "ready" ? "（需修复）" : ""}</option>`)].join("");
  return `<aside class="scope-editor" aria-label="同步范围编辑器"><header><div><p class="eyebrow">SYNC SCOPE</p><h2>${scope ? "编辑同步范围" : "新建同步范围"}</h2><p>${escapeHtml(editor.source.name)}</p></div><button class="icon-button close-button" type="button" data-action="close-editor" aria-label="关闭编辑器" title="关闭">x</button></header><form id="scope-form"><section class="editor-section scope-name-section"><label>范围名称<input name="scope-name" required value="${escapeHtml(scope?.name ?? `${editor.source.name} 同步范围`)}" /></label></section><section class="editor-section target-section"><div><h3>发布目标</h3><p>选择已准备好的 GitHub 仓库。</p></div><select name="target-id">${targetOptions}</select></section><section class="editor-section selection-section"><div class="section-heading"><div><h3>同步内容</h3><p>选择目录或单篇 Markdown 文件。</p></div></div><div class="scope-root"><label><input type="checkbox" data-action="toggle-root" ${editor.selections.some((selection) => selection.node.value === ".") ? "checked" : ""} /><span><strong>整个来源</strong><small>包含来源中的所有 Markdown 文件</small></span></label></div><div class="source-tree">${renderTree(editor)}</div></section><section class="editor-section rules-section"><div><h3>包含规则</h3><p>只同步符合这些路径规则的内容。</p></div>${renderRuleRows("include", editor.includePatterns)}</section><section class="editor-section rules-section"><div><h3>排除规则</h3><p>排除规则优先于包含规则。</p></div>${renderRuleRows("exclude", editor.excludePatterns)}</section>${editor.error ? `<p class="editor-error" role="alert">${escapeHtml(editor.error)}</p>` : ""}<footer><p class="scope-note">easyBlog 会在应用管理的工作区中安全同步此仓库。</p><div class="editor-actions"><button type="submit">保存范围</button>${scope ? `<button class="secondary-button" type="button" data-action="toggle-lifecycle" ${lifecycleDisabled}>${lifecycleLabel}</button><button class="danger-button" type="button" data-action="delete-scope" ${lifecycleDisabled}>删除</button>` : ""}</div></footer></form></aside>`;
}

export function mountSources(
  root: HTMLElement,
  api: SourcesApi = { listSources, addSource, listScopes, saveScope, setScopeLifecycle, getSourceChildren, listTargets, listGithubRepositories, refreshGithubRepositoryPermissions, connectTarget, inspectTargetConfiguration, saveTargetConfiguration, previewTargetInitialization, initializeTarget },
  onScopesChanged: () => void = () => undefined,
): void {
  let state: SourcesState = { status: "loading" };
  let scopes: ScopeSummary[] = [];
  let editor: EditorState | undefined;
  let targets: ConnectedTarget[] = [];
  let repositories: GithubRepository[] = [];
  let selectedRepository = "";
  let targetMessage = "";
  let connectingTarget = false;
  let repositoriesLoading = false;
  let configuringTarget: ConnectedTarget | undefined;
  let candidates: LayoutCandidate[] = [];
  let configurationForm: TargetConfigurationForm | undefined;
  let initialization: InitializationPreview | undefined;
  let configurationPending = false;
  const render = () => {
    if (state.status !== "ready") {
      root.innerHTML = renderSources(state);
      return;
    }
    const repositoryOptions = repositories.length ? repositories.map((repo) => `<option value="${escapeHtml(repo.repository)}" ${repo.repository === selectedRepository ? "selected" : ""}>${escapeHtml(repo.repository)} · ${repo.visibility === "private" ? "私有" : "公开"} · ${escapeHtml(repo.default_branch)}</option>`).join("") : '<option value="">没有可连接的仓库</option>';
    const targetRows = targets.map((target) => `<li><span><strong>${escapeHtml(target.repository)}</strong><small>${escapeHtml(target.default_branch)} · ${target.visibility === "private" ? "私有" : "公开"}${target.adapter ? ` · ${target.adapter === "astro_content" ? "Astro" : "GitHub Pages"}` : ""}</small></span><small>${target.state === "needs_configuration" ? "已连接，等待配置发布规则" : target.state === "ready" ? "已准备，可绑定范围" : "需要重新连接或修复"}</small>${target.state === "needs_reconnect" || target.state === "needs_recovery" ? "" : `<button class="secondary-button" type="button" data-action="configure-target" data-target-id="${escapeHtml(target.id)}">配置发布规则</button>`}</li>`).join("");
    const selectedCandidate = candidates.find((candidate) => candidate.adapter === configurationForm?.adapter);
    const configurationPanel = configuringTarget ? `<section class="target-configuration" aria-label="发布规则配置"><header><div><strong>配置 ${escapeHtml(configuringTarget.repository)}</strong><span>保存规则不会创建文件或提交更改。</span></div><button class="icon-button" type="button" data-action="close-target-configuration" aria-label="关闭发布规则配置" title="关闭">x</button></header><form id="target-configuration-form"><label>发布适配器<select name="adapter">${candidates.map((candidate) => `<option value="${candidate.adapter}" ${candidate.adapter === configurationForm?.adapter ? "selected" : ""}>${candidate.adapter === "astro_content" ? "Astro content collections" : "GitHub Pages"}</option>`).join("")}</select></label><p class="target-candidate-reason">${escapeHtml(selectedCandidate?.reason ?? "正在检查仓库布局...")}</p><label>文章目录<input name="posts-directory" required value="${escapeHtml(configurationForm?.postsDirectory ?? configuringTarget.layout.posts_directory)}" /></label><label>资源目录<input name="resources-directory" required value="${escapeHtml(configurationForm?.resourcesDirectory ?? configuringTarget.layout.resources_directory)}" /></label><footer><button type="submit" ${configurationPending ? "disabled" : ""}>${configurationPending ? "正在保存..." : "保存发布规则"}</button></footer></form>${initialization ? `<div class="initialization-preview"><strong>确认初始化</strong><p>将仅创建以下目录和配置文件：</p><ul>${initialization.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul><button type="button" data-action="confirm-target-initialization" ${configurationPending ? "disabled" : ""}>确认创建</button></div>` : ""}</section>` : "";
    const connectionDisabled = connectingTarget || !selectedRepository ? "disabled" : "";
    root.innerHTML = `<section class="sources-page scope-app" aria-labelledby="sources-title"><header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">整理本地内容，并定义每个目录的同步范围。</p></div><form class="source-form compact-source-form" id="add-source-form"><label class="compact-source-field"><span class="visually-hidden">目录路径</span><input name="path" required aria-label="目录路径" placeholder="本地目录路径" /></label><label class="compact-source-field source-name-field"><span class="visually-hidden">显示名称</span><input name="name" aria-label="显示名称（可选）" placeholder="显示名称（可选）" /></label><button type="submit">添加来源</button></form></header><section class="target-connect"><div><strong>GitHub 发布目标</strong><span>${targets.length ? `${targets.length} 个已连接` : "选择仓库后由 easyBlog 自动准备"}</span></div><form id="connect-target-form"><select name="repository" aria-label="GitHub 仓库" ${connectingTarget || repositoriesLoading ? "disabled" : ""}>${repositoryOptions}</select><button type="button" class="secondary-button" data-action="refresh-repositories" ${connectingTarget || repositoriesLoading ? "disabled" : ""}>${repositoriesLoading ? "正在加载..." : "重新加载"}</button><button type="submit" ${connectionDisabled}>${connectingTarget ? "正在连接..." : "连接仓库"}</button></form>${targetMessage ? `<p class="target-message" role="status">${escapeHtml(targetMessage)}</p>` : ""}${targetRows ? `<ul class="target-list">${targetRows}</ul>` : ""}${configurationPanel}</section><div class="scope-workspace"><main class="scope-sidebar"><div class="sidebar-heading"><div><span>来源目录</span><small>${state.sources.length} 个来源</small></div></div>${state.sources.map((source) => renderScopeList(source, scopes)).join("")}</main>${renderEditor(editor, targets)}</div></section>`;
  };
  const repositoryRefreshController = createRepositoryRefreshController(
    () => api.refreshGithubRepositoryPermissions?.() ?? api.listGithubRepositories?.() ?? Promise.resolve([]),
    (items) => {
      repositories = items;
      selectedRepository = items.some((item) => item.repository === selectedRepository) ? selectedRepository : (items[0]?.repository ?? "");
      targetMessage = items.length ? "GitHub 仓库已重新加载。" : "没有发现可推送的仓库。";
    },
  );
  const reloadRepositories = async () => {
    if (repositoryRefreshController.isLoading()) return;
    repositoriesLoading = true;
    targetMessage = "正在重新加载 GitHub 仓库...";
    render();
    try {
      await repositoryRefreshController.refresh();
    } catch (error) {
      targetMessage = errorMessage(error, "GitHub 仓库无法重新加载");
    } finally {
      repositoriesLoading = false;
      render();
    }
  };
  const refreshController = createSourcesRefreshController(api, (nextState) => {
    state = nextState;
    render();
  });
  root.addEventListener("submit", async (event) => {
    if (event.target instanceof HTMLFormElement && event.target.id === "target-configuration-form" && configuringTarget && api.saveTargetConfiguration) {
      event.preventDefault();
      const data = new FormData(event.target);
      configurationForm = {
        adapter: String(data.get("adapter")) as "github_pages" | "astro_content",
        postsDirectory: String(data.get("posts-directory") ?? ""),
        resourcesDirectory: String(data.get("resources-directory") ?? ""),
      };
      configurationPending = true; initialization = undefined; render();
      try {
        const saved = await api.saveTargetConfiguration({ target_id: configuringTarget.id, adapter: configurationForm.adapter, posts_directory: configurationForm.postsDirectory, resources_directory: configurationForm.resourcesDirectory });
        targets = targets.map((target) => target.id === saved.id ? saved : target);
        configuringTarget = saved;
        configurationForm = {
          adapter: saved.adapter ?? configurationForm.adapter,
          postsDirectory: saved.layout.posts_directory,
          resourcesDirectory: saved.layout.resources_directory,
        };
        targetMessage = saved.state === "ready" ? "发布规则已保存，仓库可以绑定范围。" : "发布规则已保存。目录尚不存在，请先确认初始化。";
        if (saved.state !== "ready" && api.previewTargetInitialization) initialization = await api.previewTargetInitialization(saved.id);
      } catch (error) { targetMessage = errorMessage(error, "发布规则无法保存"); }
      finally { configurationPending = false; render(); }
      return;
    }
    if (event.target instanceof HTMLFormElement && event.target.id === "scope-form") {
      event.preventDefault();
      if (!editor || !api.saveScope) return;
      const name = String(new FormData(event.target).get("scope-name") ?? "");
      const targetId = String(new FormData(event.target).get("target-id") ?? "");
      editor.error = undefined;
      try {
        const saved = await api.saveScope({ id: editor.scope?.id, source_id: editor.source.id, target_id: targetId || null, name, lifecycle: editor.scope?.lifecycle ?? "active", selections: editor.selections, include_patterns: editor.includePatterns, exclude_patterns: editor.excludePatterns }, editor.scope?.revision);
        editor = editorFor(editor.source, saved.scope);
        notifyScopesChanged(onScopesChanged);
        scopes = await (api.listScopes?.() ?? Promise.resolve([]));
      } catch (error) { editor.error = errorMessage(error, "Scope could not be saved"); }
      render(); return;
    }
    if (event.target instanceof HTMLFormElement && event.target.id === "connect-target-form" && api.connectTarget) {
      event.preventDefault();
      if (connectingTarget) return;
      const repository = repositories.find((item) => item.repository === selectedRepository);
      if (!repository) return;
      connectingTarget = true;
      targetMessage = `正在准备 ${repository.repository}，这可能需要一点时间...`;
      render();
      try {
        const connected = await api.connectTarget(repository);
        targets = [...targets.filter((item) => item.id !== connected.id), connected];
        targetMessage = "仓库已连接。下一步请配置发布规则后再绑定范围。";
      } catch (error) { targetMessage = errorMessage(error, "GitHub 仓库无法连接"); }
      finally { connectingTarget = false; render(); }
      return;
    }
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "add-source-form" || !api.addSource) return;
    event.preventDefault();
    const data = new FormData(form);
    const requestGeneration = refreshController.begin();
    try {
      state = { status: "loading" };
      render();
      const addedSource = await api.addSource({
        path: String(data.get("path") ?? ""),
        name: String(data.get("name") ?? "") || undefined,
      });
      notifyScopesChanged(onScopesChanged);
      const nextState = await loadSources(api);
      if (refreshController.isCurrent(requestGeneration)) {
        state = nextState;
        scopes = await (api.listScopes?.() ?? Promise.resolve([]));
        if (state.status === "ready" && state.sources.some((item) => item.id === addedSource.id)) editor = editorFor(addedSource);
        render();
      }
    } catch (error) {
      if (refreshController.isCurrent(requestGeneration)) {
        state = { status: "error", message: errorMessage(error, "Source could not be added") };
        render();
      }
    }
  });
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "retry") { void refreshController.refresh(); return; }
    if (action === "refresh-repositories") { void reloadRepositories(); return; }
    if (action === "close-target-configuration") { configuringTarget = undefined; candidates = []; configurationForm = undefined; initialization = undefined; render(); return; }
    if (action === "configure-target") {
      const selected = targets.find((item) => item.id === target.dataset.targetId);
      if (!selected || !api.inspectTargetConfiguration) return;
      configuringTarget = selected; candidates = []; configurationForm = undefined; initialization = undefined; targetMessage = "正在检查仓库布局..."; render();
      void api.inspectTargetConfiguration(selected.id).then((items) => {
        candidates = items;
        const selectedCandidate = items.find((candidate) => candidate.adapter === selected.adapter) ?? items[0];
        if (selectedCandidate) configurationForm = { adapter: selectedCandidate.adapter, postsDirectory: selected.adapter ? selected.layout.posts_directory : selectedCandidate.posts_directory, resourcesDirectory: selected.adapter ? selected.layout.resources_directory : selectedCandidate.resources_directory };
        render();
      }).catch((error) => { targetMessage = errorMessage(error, "仓库布局无法检查"); render(); });
      return;
    }
    if (action === "confirm-target-initialization" && configuringTarget && api.initializeTarget) {
      configurationPending = true; render();
      void api.initializeTarget(configuringTarget.id).then((saved) => { targets = targets.map((item) => item.id === saved.id ? saved : item); targetMessage = "发布目录已初始化，仓库现在可以绑定范围。"; configuringTarget = undefined; configurationForm = undefined; initialization = undefined; }).catch((error) => { targetMessage = errorMessage(error, "发布目录无法初始化"); }).finally(() => { configurationPending = false; render(); });
      return;
    }
    const source = state.status === "ready" ? state.sources.find((item) => item.id === target.dataset.sourceId) : undefined;
    if (action === "new-scope" && source) { editor = editorFor(source); render(); void loadChildren(editor, ".", api, render); return; }
    if (action === "edit-scope" && source) { const summary = scopes.find((item) => item.scope.id === target.dataset.scopeId); if (summary) { editor = editorFor(source, summary.scope); render(); void loadChildren(editor, ".", api, render); } return; }
    if (action === "close-editor") { editor = undefined; render(); return; }
    if (!editor) return;
    if (action === "toggle-tree") { const path = target.dataset.path ?? "."; if (editor.expanded.has(path)) editor.expanded.delete(path); else { editor.expanded.add(path); void loadChildren(editor, path, api, render); } render(); return; }
    if (action === "add-rule") { const rules = target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns; rules.push(""); render(); return; }
    if (action === "remove-rule") { const rules = target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns; rules.splice(Number(target.dataset.ruleIndex), 1); render(); return; }
    if ((action === "toggle-lifecycle" || action === "delete-scope") && editor.scope && api.setScopeLifecycle && !editor.lifecyclePending) {
      const activeEditor = editor;
      const activeScope = activeEditor.scope;
      if (!activeScope) return;
      activeEditor.lifecyclePending = true;
      activeEditor.error = undefined;
      render();
      const lifecycle = action === "delete-scope" ? "deleted" : activeScope.lifecycle === "paused" ? "active" : "paused";
      void api.setScopeLifecycle(activeScope.id, lifecycle, activeScope.revision).then(async () => {
        notifyScopesChanged(onScopesChanged);
        scopes = await (api.listScopes?.() ?? Promise.resolve([]));
        if (editor !== activeEditor) return;
        editor = lifecycle === "deleted" ? undefined : editorFor(activeEditor.source, scopes.find((item) => item.scope.id === activeScope.id)?.scope);
      }).catch((error) => {
        if (editor === activeEditor) activeEditor.error = errorMessage(error, "Scope lifecycle could not be updated");
      }).finally(() => {
        if (editor === activeEditor) activeEditor.lifecyclePending = false;
        render();
      });
      return;
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input instanceof HTMLSelectElement && input.name === "repository") { selectedRepository = input.value; render(); return; }
    if (input instanceof HTMLSelectElement && input.name === "adapter") {
      const candidate = candidates.find((item) => item.adapter === input.value);
      if (candidate) {
        configurationForm = { adapter: candidate.adapter, postsDirectory: candidate.posts_directory, resourcesDirectory: candidate.resources_directory };
        initialization = undefined;
        render();
      }
      return;
    }
    if (!editor || !(input instanceof HTMLInputElement)) return;
    const action = input.dataset.action;
    const path = input.dataset.path;
    if (action === "toggle-root") { toggleSelection(editor, { kind: "local_path", value: "." }, "整个来源", true, input.checked); render(); return; }
    if (action === "toggle-selection" && path) { toggleSelection(editor, { kind: "local_path", value: path }, input.dataset.name ?? path, Object.values(editor.children).flat().some((node) => node.reference.value === path && node.kind === "directory"), input.checked); render(); return; }
    if (action === "toggle-recursive" && path) { const selection = editor.selections.find((item) => item.node.value === path); if (selection) selection.recursive = input.checked; render(); return; }
    const rules = input.dataset.ruleKind === "include" ? editor.includePatterns : input.dataset.ruleKind === "exclude" ? editor.excludePatterns : undefined;
    if (rules && input.dataset.ruleIndex !== undefined) rules[Number(input.dataset.ruleIndex)] = input.value;
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !configurationForm) return;
    if (input.name === "posts-directory") configurationForm.postsDirectory = input.value;
    if (input.name === "resources-directory") configurationForm.resourcesDirectory = input.value;
  });
  render();
  void refreshController.refresh().then(async () => { [scopes, targets] = await Promise.all([api.listScopes?.() ?? Promise.resolve([]), api.listTargets?.() ?? Promise.resolve([])]); render(); await reloadRepositories(); });
}

function toggleSelection(editor: EditorState, node: SourceNodeRef, displayName: string, isDirectory: boolean, selected: boolean): void { const key = selectionKey(node); const index = editor.selections.findIndex((selection) => selectionKey(selection.node) === key); if (selected && index < 0) editor.selections.push({ node, display_name: displayName, recursive: isDirectory }); if (!selected && index >= 0) editor.selections.splice(index, 1); }
async function loadChildren(editor: EditorState, parent: string, api: SourcesApi, render: () => void): Promise<void> { if (editor.children[parent] || editor.loading.has(parent) || !api.getSourceChildren) return; editor.loading.add(parent); render(); try { editor.children[parent] = await api.getSourceChildren(editor.source.id, parent === "." ? undefined : { kind: "local_path", value: parent }); } catch (error) { editor.error = errorMessage(error, "Source directory could not be read"); } finally { editor.loading.delete(parent); render(); } }
