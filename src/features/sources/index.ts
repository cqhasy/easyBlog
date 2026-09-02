import { addSource, getSourceChildren, listScopes, listSources, saveScope, setScopeLifecycle } from "../../bridge/sources";
import type { AddSourceInput } from "../../bridge/sources";
import type { SaveScopeInput, Scope, ScopeLifecycle, ScopeSelection, ScopeSummary, Source, SourceNodeRef, SourceTreeNode } from "../../contracts";

export const sourcesFeature = "sources";

export type SourcesApi = {
  listSources: () => Promise<Source[]>;
  addSource?: (input: AddSourceInput) => Promise<Source>;
  listScopes?: (sourceId?: string) => Promise<ScopeSummary[]>;
  saveScope?: (input: SaveScopeInput, expectedRevision?: number) => Promise<ScopeSummary>;
  setScopeLifecycle?: (scopeId: string, lifecycle: ScopeLifecycle, expectedRevision: number) => Promise<ScopeSummary>;
  getSourceChildren?: (sourceId: string, parent?: SourceNodeRef) => Promise<SourceTreeNode[]>;
};

export type SourcesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; sources: Source[] }
  | { status: "error"; message: string };

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
  error?: string;
};

function selectionKey(reference: SourceNodeRef): string { return `${reference.kind}:${reference.value}`; }
function editorFor(source: Source, scope?: Scope): EditorState {
  return { source, scope, selections: scope?.selections ?? [], includePatterns: scope?.include_patterns ?? [], excludePatterns: scope?.exclude_patterns ?? [], children: {}, expanded: new Set(), loading: new Set() };
}
function scopeLabel(summary: ScopeSummary): string { return summary.scope.lifecycle === "paused" ? "已暂停" : summary.health === "needs_target" ? "待绑定目标" : "可用"; }
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
function renderEditor(editor?: EditorState): string {
  if (!editor) return '<aside class="scope-editor scope-editor-empty"><div><span class="empty-mark" aria-hidden="true">+</span><h2>选择一个同步范围</h2><p>从左侧选择已有范围，或为来源新建一个范围。</p></div></aside>';
  const scope = editor.scope;
  return `<aside class="scope-editor" aria-label="同步范围编辑器"><header><div><p class="eyebrow">SYNC SCOPE</p><h2>${scope ? "编辑同步范围" : "新建同步范围"}</h2><p>${escapeHtml(editor.source.name)}</p></div><button class="icon-button close-button" type="button" data-action="close-editor" aria-label="关闭编辑器" title="关闭">x</button></header><form id="scope-form"><section class="editor-section scope-name-section"><label>范围名称<input name="scope-name" required value="${escapeHtml(scope?.name ?? `${editor.source.name} 同步范围`)}" /></label></section><section class="editor-section selection-section"><div class="section-heading"><div><h3>同步内容</h3><p>选择目录或单篇 Markdown 文件。</p></div></div><div class="scope-root"><label><input type="checkbox" data-action="toggle-root" ${editor.selections.some((selection) => selection.node.value === ".") ? "checked" : ""} /><span><strong>整个来源</strong><small>包含来源中的所有 Markdown 文件</small></span></label></div><div class="source-tree">${renderTree(editor)}</div></section><section class="editor-section rules-section"><div><h3>包含规则</h3><p>只同步符合这些路径规则的内容。</p></div>${renderRuleRows("include", editor.includePatterns)}</section><section class="editor-section rules-section"><div><h3>排除规则</h3><p>排除规则优先于包含规则。</p></div>${renderRuleRows("exclude", editor.excludePatterns)}</section>${editor.error ? `<p class="editor-error" role="alert">${escapeHtml(editor.error)}</p>` : ""}<footer><p class="scope-note">发布目标将在后续配置。</p><div class="editor-actions"><button type="submit">保存范围</button>${scope ? `<button class="secondary-button" type="button" data-action="toggle-lifecycle">${scope.lifecycle === "paused" ? "恢复" : "暂停"}</button><button class="danger-button" type="button" data-action="delete-scope">删除</button>` : ""}</div></footer></form></aside>`;
}

export function mountSources(root: HTMLElement, api: SourcesApi = { listSources, addSource, listScopes, saveScope, setScopeLifecycle, getSourceChildren }): void {
  let state: SourcesState = { status: "loading" };
  let scopes: ScopeSummary[] = [];
  let editor: EditorState | undefined;
  const render = () => {
    if (state.status !== "ready") {
      root.innerHTML = renderSources(state);
      return;
    }
    root.innerHTML = `<section class="sources-page scope-app" aria-labelledby="sources-title"><header class="workspace-header"><div><p class="eyebrow">EASYBLOG / SOURCES</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">整理本地内容，并定义每个目录的同步范围。</p></div><form class="source-form compact-source-form" id="add-source-form"><label class="compact-source-field"><span class="visually-hidden">目录路径</span><input name="path" required aria-label="目录路径" placeholder="本地目录路径" /></label><label class="compact-source-field source-name-field"><span class="visually-hidden">显示名称</span><input name="name" aria-label="显示名称（可选）" placeholder="显示名称（可选）" /></label><button type="submit">添加来源</button></form></header><div class="scope-workspace"><main class="scope-sidebar"><div class="sidebar-heading"><div><span>来源目录</span><small>${state.sources.length} 个来源</small></div></div>${state.sources.map((source) => renderScopeList(source, scopes)).join("")}</main>${renderEditor(editor)}</div></section>`;
  };
  const refreshController = createSourcesRefreshController(api, (nextState) => {
    state = nextState;
    render();
  });
  root.addEventListener("submit", async (event) => {
    if (event.target instanceof HTMLFormElement && event.target.id === "scope-form") {
      event.preventDefault();
      if (!editor || !api.saveScope) return;
      const name = String(new FormData(event.target).get("scope-name") ?? "");
      editor.error = undefined;
      try {
        const saved = await api.saveScope({ id: editor.scope?.id, source_id: editor.source.id, target_id: null, name, lifecycle: editor.scope?.lifecycle ?? "active", selections: editor.selections, include_patterns: editor.includePatterns, exclude_patterns: editor.excludePatterns }, editor.scope?.revision);
        editor = editorFor(editor.source, saved.scope);
        scopes = await (api.listScopes?.() ?? Promise.resolve([]));
      } catch (error) { editor.error = errorMessage(error, "Scope could not be saved"); }
      render(); return;
    }
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "add-source-form" || !api.addSource) return;
    event.preventDefault();
    const data = new FormData(form);
    const requestGeneration = refreshController.begin();
    try {
      state = { status: "loading" };
      render();
      const nextState = await addSourceAndReload(api as Required<SourcesApi>, {
        path: String(data.get("path") ?? ""),
        name: String(data.get("name") ?? "") || undefined,
      });
      if (refreshController.isCurrent(requestGeneration)) {
        state = nextState;
        scopes = await (api.listScopes?.() ?? Promise.resolve([]));
        const addedSource = state.status === "ready" ? state.sources.find((item) => item.id === (nextState.status === "ready" ? nextState.sources.at(-1)?.id : undefined)) : undefined;
        if (addedSource) editor = editorFor(addedSource);
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
    const source = state.status === "ready" ? state.sources.find((item) => item.id === target.dataset.sourceId) : undefined;
    if (action === "new-scope" && source) { editor = editorFor(source); render(); void loadChildren(editor, ".", api, render); return; }
    if (action === "edit-scope" && source) { const summary = scopes.find((item) => item.scope.id === target.dataset.scopeId); if (summary) { editor = editorFor(source, summary.scope); render(); void loadChildren(editor, ".", api, render); } return; }
    if (action === "close-editor") { editor = undefined; render(); return; }
    if (!editor) return;
    if (action === "toggle-tree") { const path = target.dataset.path ?? "."; if (editor.expanded.has(path)) editor.expanded.delete(path); else { editor.expanded.add(path); void loadChildren(editor, path, api, render); } render(); return; }
    if (action === "add-rule") { const rules = target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns; rules.push(""); render(); return; }
    if (action === "remove-rule") { const rules = target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns; rules.splice(Number(target.dataset.ruleIndex), 1); render(); return; }
    if (action === "toggle-lifecycle" && editor.scope && api.setScopeLifecycle) { void api.setScopeLifecycle(editor.scope.id, editor.scope.lifecycle === "paused" ? "active" : "paused", editor.scope.revision).then(async () => { scopes = await (api.listScopes?.() ?? Promise.resolve([])); const saved = scopes.find((item) => item.scope.id === editor?.scope?.id); if (saved && editor) editor = editorFor(editor.source, saved.scope); render(); }); return; }
    if (action === "delete-scope" && editor.scope && api.setScopeLifecycle) { void api.setScopeLifecycle(editor.scope.id, "deleted", editor.scope.revision).then(async () => { scopes = await (api.listScopes?.() ?? Promise.resolve([])); editor = undefined; render(); }); }
  });
  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (!editor || !(input instanceof HTMLInputElement)) return;
    const action = input.dataset.action;
    const path = input.dataset.path;
    if (action === "toggle-root") { toggleSelection(editor, { kind: "local_path", value: "." }, "整个来源", true, input.checked); render(); return; }
    if (action === "toggle-selection" && path) { toggleSelection(editor, { kind: "local_path", value: path }, input.dataset.name ?? path, Object.values(editor.children).flat().some((node) => node.reference.value === path && node.kind === "directory"), input.checked); render(); return; }
    if (action === "toggle-recursive" && path) { const selection = editor.selections.find((item) => item.node.value === path); if (selection) selection.recursive = input.checked; render(); return; }
    const rules = input.dataset.ruleKind === "include" ? editor.includePatterns : input.dataset.ruleKind === "exclude" ? editor.excludePatterns : undefined;
    if (rules && input.dataset.ruleIndex !== undefined) rules[Number(input.dataset.ruleIndex)] = input.value;
  });
  render();
  void refreshController.refresh().then(async () => { scopes = await (api.listScopes?.() ?? Promise.resolve([])); render(); });
}

function toggleSelection(editor: EditorState, node: SourceNodeRef, displayName: string, isDirectory: boolean, selected: boolean): void { const key = selectionKey(node); const index = editor.selections.findIndex((selection) => selectionKey(selection.node) === key); if (selected && index < 0) editor.selections.push({ node, display_name: displayName, recursive: isDirectory }); if (!selected && index >= 0) editor.selections.splice(index, 1); }
async function loadChildren(editor: EditorState, parent: string, api: SourcesApi, render: () => void): Promise<void> { if (editor.children[parent] || editor.loading.has(parent) || !api.getSourceChildren) return; editor.loading.add(parent); render(); try { editor.children[parent] = await api.getSourceChildren(editor.source.id, parent === "." ? undefined : { kind: "local_path", value: parent }); } catch (error) { editor.error = errorMessage(error, "Source directory could not be read"); } finally { editor.loading.delete(parent); render(); } }
