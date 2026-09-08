import type { ConnectedTarget, LayoutCandidate, Scope, ScopeSelection, Source, SourceNodeRef, SourceTreeNode } from "../../contracts";
import { defaultSourcesApi, type SourcesApi } from "./index";

export type EditorNavigation = {
  backToSources: (resourceId?: string) => void;
};

type TargetConfigurationForm = {
  adapter: "github_pages" | "astro_content";
  postsDirectory: string;
  resourcesDirectory: string;
};

export type SourceEditorState = {
  source: Source;
  scope?: Scope;
  targets: ConnectedTarget[];
  name?: string;
  targetId?: string | null;
  selections: ScopeSelection[];
  includePatterns: string[];
  excludePatterns: string[];
  children: Record<string, SourceTreeNode[]>;
  expanded: Set<string>;
  loading: Set<string>;
  dirty: boolean;
  saving: boolean;
  lifecyclePending?: boolean;
  error?: string;
};

export type TargetEditorState = {
  target: ConnectedTarget;
  candidates: LayoutCandidate[];
  form: TargetConfigurationForm;
  initialization?: { files: string[] };
  dirty: boolean;
  saving: boolean;
  error?: string;
};

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

function selectionKey(reference: SourceNodeRef): string {
  return `${reference.kind}:${reference.value}`;
}

function sourceEditorFor(source: Source, scope: Scope | undefined, targets: ConnectedTarget[]): SourceEditorState {
  return {
    source,
    scope,
    targets,
    name: scope?.name ?? `${source.name} 同步范围`,
    targetId: scope?.target_id ?? null,
    selections: scope?.selections.map((selection) => ({ ...selection, node: { ...selection.node } })) ?? [],
    includePatterns: [...(scope?.include_patterns ?? [])],
    excludePatterns: [...(scope?.exclude_patterns ?? [])],
    children: {},
    expanded: new Set(),
    loading: new Set(),
    dirty: false,
    saving: false,
    lifecyclePending: false,
  };
}

function targetStatus(target: ConnectedTarget): string {
  if (target.state === "ready") return "可用";
  if (target.state === "needs_configuration") return "待配置";
  if (target.state === "needs_reconnect") return "需要重新连接";
  return "需要修复";
}

function adapterLabel(adapter: "github_pages" | "astro_content"): string {
  return adapter === "astro_content" ? "Astro 内容集合" : "GitHub Pages";
}

function renderRuleRows(kind: "include" | "exclude", patterns: string[]): string {
  const rows = patterns.map((pattern, index) => `<div class="rule-row"><input data-rule-kind="${kind}" data-rule-index="${index}" value="${escapeHtml(pattern)}" placeholder="例如：posts/**/*.md" /><button type="button" class="icon-button" aria-label="删除规则" title="删除规则" data-action="remove-rule" data-rule-kind="${kind}" data-rule-index="${index}">×</button></div>`).join("");
  return `<div class="rule-list">${rows}<button class="task-primary-button add-rule-button" type="button" data-action="add-rule" data-rule-kind="${kind}">添加规则</button></div>`;
}

function renderTree(editor: SourceEditorState, parent = ".", depth = 0): string {
  const nodes = editor.children[parent];
  if (editor.loading.has(parent)) return '<p class="tree-status">正在读取目录...</p>';
  if (!nodes) return depth === 0 ? '<p class="tree-status">正在读取可选择的内容...</p>' : "";
  return `<ul class="tree-list">${nodes.map((node) => {
    const key = selectionKey(node.reference);
    const selected = editor.selections.some((selection) => selectionKey(selection.node) === key);
    const expanded = editor.expanded.has(node.reference.value);
    const subtree = node.kind === "directory" && expanded ? renderTree(editor, node.reference.value, depth + 1) : "";
    const disabled = node.selectable ? "" : "disabled";
    const directoryControls = node.kind === "directory"
      ? `<button class="tree-toggle" type="button" data-action="toggle-tree" data-path="${escapeHtml(node.reference.value)}" aria-label="展开或收起 ${escapeHtml(node.display_name)}" title="展开或收起">${expanded ? "−" : "+"}</button>`
      : '<span class="tree-spacer"></span>';
    const recursive = editor.selections.find((selection) => selectionKey(selection.node) === key)?.recursive;
    return `<li><div class="tree-node" style="--depth:${depth}">${directoryControls}<label><input type="checkbox" data-action="toggle-selection" data-path="${escapeHtml(node.reference.value)}" data-name="${escapeHtml(node.display_name)}" data-directory="${node.kind === "directory"}" ${selected ? "checked" : ""} ${disabled} />${escapeHtml(node.display_name)}</label>${selected && node.kind === "directory" ? `<label class="recursive-toggle"><input type="checkbox" data-action="toggle-recursive" data-path="${escapeHtml(node.reference.value)}" ${recursive ? "checked" : ""} />包含子目录</label>` : ""}</div>${subtree}</li>`;
  }).join("")}</ul>`;
}

export function renderSourceEditor(editor: SourceEditorState): string {
  const scope = editor.scope;
  const targetOptions = [
    '<option value="">暂不绑定</option>',
    ...editor.targets.map((target) => `<option value="${escapeHtml(target.id)}" ${target.state !== "ready" ? "disabled" : ""} ${editor.targetId === target.id ? "selected" : ""}>${escapeHtml(target.repository)}${target.state === "ready" ? "" : "（不可用）"}</option>`),
  ].join("");
  const lifecycleLabel = scope?.lifecycle === "paused" ? "恢复范围" : "暂停范围";
  const rootSelected = editor.selections.some((selection) => selection.node.value === ".");
  const disabled = editor.saving ? "disabled" : "";
  const operation = editor.saving
    ? '<p class="editor-operation" role="status" aria-live="polite">正在保存同步范围...</p>'
    : editor.lifecyclePending
      ? '<p class="editor-operation" role="status" aria-live="polite">正在更新同步范围状态...</p>'
      : "";
  return `<section class="focused-editor-page source-focused-editor" aria-labelledby="source-editor-title"><header class="focused-editor-header"><button type="button" class="back-button" data-action="back-to-sources" aria-label="返回内容来源" title="返回内容来源">←</button><div><p class="eyebrow">同步范围</p><h1 id="source-editor-title">${scope ? "编辑同步范围" : "新建同步范围"}</h1><p>${escapeHtml(editor.source.name)} · ${escapeHtml(editor.source.path)}</p></div></header><form id="source-editor-form" class="focused-editor-form"><section class="editor-section scope-name-section"><label>范围名称<input name="scope-name" required value="${escapeHtml(editor.name ?? `${editor.source.name} 同步范围`)}" ${disabled} /></label></section><section class="editor-section target-section"><div><h2>发布目标</h2><p>选择已准备好的 GitHub 仓库。</p></div><select name="target-id" ${disabled}>${targetOptions}</select></section><section class="editor-section selection-section"><div class="section-heading"><div><h2>同步内容</h2><p>选择目录或单篇 Markdown 文件。</p></div></div><div class="scope-root"><label><input type="checkbox" data-action="toggle-root" ${rootSelected ? "checked" : ""} ${disabled} /><span><strong>整个来源</strong><small>包含来源中的所有 Markdown 文件</small></span></label></div><div class="source-tree">${renderTree(editor)}</div></section><details class="focused-advanced"><summary>高级规则</summary><div class="advanced-content"><section class="editor-section rules-section"><div><h2>包含规则</h2><p>只同步符合这些路径规则的内容。</p></div>${renderRuleRows("include", editor.includePatterns)}</section><section class="editor-section rules-section"><div><h2>排除规则</h2><p>排除规则优先于包含规则。</p></div>${renderRuleRows("exclude", editor.excludePatterns)}</section></div></details>${editor.error ? `<p class="editor-error" role="alert">${escapeHtml(editor.error)}</p>` : ""}<footer class="editor-action-row"><div>${scope ? `<details class="editor-overflow"><summary>更多操作</summary><button type="button" class="secondary-button" data-action="toggle-lifecycle" ${editor.lifecyclePending ? "disabled" : ""}>${lifecycleLabel}</button><button type="button" class="danger-button" data-action="delete-scope" ${editor.lifecyclePending ? "disabled" : ""}>删除范围</button></details>` : ""}</div>${operation}<div class="editor-actions"><button type="button" class="secondary-button" data-action="cancel-edit" ${disabled}>取消</button><button type="submit" class="task-primary-button" ${disabled}>${editor.saving ? "正在保存..." : "保存"}</button></div></footer></form></section>`;
}

export function targetEditorSaveFailed(state: TargetEditorState, error: string): TargetEditorState {
  return { ...state, form: { ...state.form }, saving: false, error };
}

export function targetEditorDirectoryChanged(
  state: TargetEditorState,
  field: "postsDirectory" | "resourcesDirectory",
  value: string,
): TargetEditorState {
  return {
    ...state,
    form: { ...state.form, [field]: value },
    initialization: undefined,
    dirty: true,
  };
}

export function renderTargetEditor(editor: TargetEditorState): string {
  const selectedCandidate = editor.candidates.find((candidate) => candidate.adapter === editor.form.adapter);
  const adapterOptions = editor.candidates.length
    ? editor.candidates.map((candidate) => `<option value="${candidate.adapter}" ${candidate.adapter === editor.form.adapter ? "selected" : ""}>${adapterLabel(candidate.adapter)}</option>`).join("")
    : `<option value="${editor.form.adapter}">${adapterLabel(editor.form.adapter)}</option>`;
  const disabled = editor.saving ? "disabled" : "";
  const operation = editor.saving
    ? '<p class="editor-operation" role="status" aria-live="polite">正在保存发布目标...</p>'
    : "";
  const initialization = editor.initialization
    ? `<section class="initialization-preview" aria-labelledby="initialization-title"><h2 id="initialization-title">确认初始化</h2><p>将仅创建以下目录和配置文件：</p><ul>${editor.initialization.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul><details class="editor-overflow"><summary>初始化操作</summary><button type="button" class="danger-button" data-action="confirm-target-initialization" ${disabled}>确认创建</button></details></section>`
    : "";
  return `<section class="focused-editor-page target-focused-editor" aria-labelledby="target-editor-title"><header class="focused-editor-header"><button type="button" class="back-button" data-action="back-to-sources" aria-label="返回内容来源" title="返回内容来源">←</button><div><p class="eyebrow">GitHub 目标</p><h1 id="target-editor-title">编辑发布目标</h1><p>${escapeHtml(editor.target.repository)} · ${targetStatus(editor.target)}</p></div></header><form id="target-editor-form" class="focused-editor-form"><section class="editor-section"><label>发布适配器<select name="adapter" ${disabled}>${adapterOptions}</select></label><p class="target-candidate-reason">${escapeHtml(selectedCandidate?.reason ?? "正在检查仓库布局...")}</p></section><section class="editor-section editor-fields"><label>文章目录<input name="posts-directory" required value="${escapeHtml(editor.form.postsDirectory)}" ${disabled} /></label><label>资源目录<input name="resources-directory" required value="${escapeHtml(editor.form.resourcesDirectory)}" ${disabled} /></label></section>${editor.error ? `<p class="editor-error" role="alert">${escapeHtml(editor.error)}</p>` : ""}${initialization}<footer class="editor-action-row"><span>保存后会先检查是否需要初始化目录。</span>${operation}<div class="editor-actions"><button type="button" class="secondary-button" data-action="cancel-edit" ${disabled}>取消</button><button type="submit" class="task-primary-button" ${disabled}>${editor.saving ? "正在保存..." : "保存"}</button></div></footer></form></section>`;
}

function setSelection(editor: SourceEditorState, node: SourceNodeRef, displayName: string, recursive: boolean, selected: boolean): void {
  const key = selectionKey(node);
  const index = editor.selections.findIndex((selection) => selectionKey(selection.node) === key);
  if (selected && index < 0) editor.selections.push({ node, display_name: displayName, recursive });
  if (!selected && index >= 0) editor.selections.splice(index, 1);
  editor.dirty = true;
}

async function loadChildren(editor: SourceEditorState, parent: string, api: SourcesApi, render: () => void): Promise<void> {
  if (editor.children[parent] || editor.loading.has(parent) || !api.getSourceChildren) return;
  editor.loading.add(parent);
  render();
  try {
    editor.children[parent] = await api.getSourceChildren(editor.source.id, parent === "." ? undefined : { kind: "local_path", value: parent });
  } catch (error) {
    editor.error = errorMessage(error, "来源目录无法读取");
  } finally {
    editor.loading.delete(parent);
    render();
  }
}

function confirmDiscard(editor: { dirty: boolean }): boolean {
  return !editor.dirty || window.confirm("尚未保存的更改将被丢弃，确定返回吗？");
}

export function mountSourceEditor(
  root: HTMLElement,
  api: SourcesApi = defaultSourcesApi,
  sourceId: string,
  scopeId: string | undefined,
  navigation: EditorNavigation,
  isActive: () => boolean = () => true,
): void {
  let editor: SourceEditorState | undefined;
  const render = () => {
    if (!isActive()) return;
    root.innerHTML = editor
      ? renderSourceEditor(editor)
      : '<section class="focused-editor-page"><p class="sources-status" role="status">正在加载同步范围...</p></section>';
  };
  const back = () => {
    if (!isActive()) return;
    if (!editor || confirmDiscard(editor)) navigation.backToSources(sourceId);
  };
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "source-editor-form" || !editor || !api.saveScope) return;
    event.preventDefault();
    const activeEditor = editor;
    const data = new FormData(form);
    activeEditor.name = String(data.get("scope-name") ?? "");
    activeEditor.targetId = String(data.get("target-id") ?? "") || null;
    activeEditor.saving = true;
    activeEditor.error = undefined;
    render();
    void api.saveScope({
      id: activeEditor.scope?.id,
      source_id: activeEditor.source.id,
      target_id: activeEditor.targetId,
      name: activeEditor.name,
      lifecycle: activeEditor.scope?.lifecycle ?? "active",
      selections: activeEditor.selections,
      include_patterns: activeEditor.includePatterns,
      exclude_patterns: activeEditor.excludePatterns,
    }, activeEditor.scope?.revision).then(() => {
      if (!isActive() || editor !== activeEditor) return;
      navigation.backToSources(activeEditor.source.id);
    }).catch((error) => {
      if (!isActive() || editor !== activeEditor) return;
      activeEditor.saving = false;
      activeEditor.error = errorMessage(error, "同步范围无法保存");
      render();
    });
  });
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "back-to-sources" || action === "cancel-edit") {
      if (editor) back();
      else navigation.backToSources(sourceId);
      return;
    }
    if (!editor) return;
    if (action === "toggle-tree") {
      const path = target.dataset.path ?? ".";
      if (editor.expanded.has(path)) editor.expanded.delete(path);
      else {
        editor.expanded.add(path);
        void loadChildren(editor, path, api, render);
      }
      render();
      return;
    }
    if (action === "add-rule") {
      (target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns).push("");
      editor.dirty = true;
      render();
      return;
    }
    if (action === "remove-rule") {
      (target.dataset.ruleKind === "include" ? editor.includePatterns : editor.excludePatterns).splice(Number(target.dataset.ruleIndex), 1);
      editor.dirty = true;
      render();
      return;
    }
    if ((action === "toggle-lifecycle" || action === "delete-scope") && editor.scope && api.setScopeLifecycle && !editor.lifecyclePending) {
      const activeEditor = editor;
      const activeScope = activeEditor.scope;
      if (!activeScope) return;
      const lifecycle = action === "delete-scope"
        ? "deleted"
        : activeScope.lifecycle === "paused"
          ? "active"
          : "paused";
      const confirmation = lifecycle === "deleted"
        ? "删除此同步范围吗？此操作会停止后续同步。"
        : lifecycle === "paused"
          ? "暂停此同步范围吗？"
          : "恢复此同步范围吗？";
      if (!window.confirm(confirmation)) return;
      activeEditor.lifecyclePending = true;
      activeEditor.error = undefined;
      render();
      void api.setScopeLifecycle(activeScope.id, lifecycle, activeScope.revision).then((saved) => {
        if (!isActive() || editor !== activeEditor) return;
        if (lifecycle === "deleted") {
          navigation.backToSources(activeEditor.source.id);
          return;
        }
        activeEditor.scope = saved.scope;
        activeEditor.dirty = false;
      }).catch((error) => {
        if (isActive() && editor === activeEditor) activeEditor.error = errorMessage(error, "同步范围状态无法更新");
      }).finally(() => {
        if (isActive() && editor === activeEditor) {
          activeEditor.lifecyclePending = false;
          render();
        }
      });
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (!editor || !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input instanceof HTMLSelectElement && input.name === "target-id") {
      editor.targetId = input.value || null;
      editor.dirty = true;
      return;
    }
    if (!(input instanceof HTMLInputElement)) return;
    const action = input.dataset.action;
    const path = input.dataset.path;
    if (action === "toggle-root") {
      setSelection(editor, { kind: "local_path", value: "." }, "整个来源", true, input.checked);
      render();
      return;
    }
    if (action === "toggle-selection" && path) {
      setSelection(editor, { kind: "local_path", value: path }, input.dataset.name ?? path, input.dataset.directory === "true", input.checked);
      render();
      return;
    }
    if (action === "toggle-recursive" && path) {
      const selection = editor.selections.find((item) => item.node.value === path);
      if (selection) {
        selection.recursive = input.checked;
        editor.dirty = true;
      }
      render();
    }
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (!editor || !(input instanceof HTMLInputElement)) return;
    if (input.name === "scope-name") {
      editor.name = input.value;
      editor.dirty = true;
      return;
    }
    const rules = input.dataset.ruleKind === "include"
      ? editor.includePatterns
      : input.dataset.ruleKind === "exclude"
        ? editor.excludePatterns
        : undefined;
    if (rules && input.dataset.ruleIndex !== undefined) {
      rules[Number(input.dataset.ruleIndex)] = input.value;
      editor.dirty = true;
    }
  });
  render();
  void Promise.all([
    api.listSources(),
    api.listScopes?.() ?? Promise.resolve([]),
    api.listTargets?.() ?? Promise.resolve([]),
  ]).then(([sources, scopes, targets]) => {
    if (!isActive()) return;
    const source = sources.find((item) => item.id === sourceId);
    if (!source) {
      root.innerHTML = '<section class="focused-editor-page"><p class="editor-error" role="alert">未找到内容来源。</p><button type="button" data-action="back-to-sources">返回内容来源</button></section>';
      return;
    }
    editor = sourceEditorFor(source, scopes.find((summary) => summary.scope.id === scopeId)?.scope, targets);
    render();
    void loadChildren(editor, ".", api, render);
  }).catch((error) => {
    if (!isActive()) return;
    root.innerHTML = `<section class="focused-editor-page"><p class="editor-error" role="alert">${escapeHtml(errorMessage(error, "同步范围无法加载"))}</p><button type="button" data-action="back-to-sources">返回内容来源</button></section>`;
  });
}

export function mountTargetEditor(
  root: HTMLElement,
  api: SourcesApi = defaultSourcesApi,
  targetId: string,
  navigation: EditorNavigation,
  isActive: () => boolean = () => true,
): void {
  let editor: TargetEditorState | undefined;
  const render = () => {
    if (!isActive()) return;
    root.innerHTML = editor
      ? renderTargetEditor(editor)
      : '<section class="focused-editor-page"><p class="sources-status" role="status">正在加载发布目标...</p></section>';
  };
  const back = () => {
    if (!isActive()) return;
    if (!editor || confirmDiscard(editor)) navigation.backToSources(targetId);
  };
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "target-editor-form" || !editor || !api.saveTargetConfiguration) return;
    event.preventDefault();
    const activeEditor = editor;
    const data = new FormData(form);
    activeEditor.form = {
      adapter: String(data.get("adapter")) as "github_pages" | "astro_content",
      postsDirectory: String(data.get("posts-directory") ?? ""),
      resourcesDirectory: String(data.get("resources-directory") ?? ""),
    };
    activeEditor.saving = true;
    activeEditor.error = undefined;
    render();
    void api.saveTargetConfiguration({
      target_id: activeEditor.target.id,
      adapter: activeEditor.form.adapter,
      posts_directory: activeEditor.form.postsDirectory,
      resources_directory: activeEditor.form.resourcesDirectory,
    }).then(async (saved) => {
      if (!isActive() || editor !== activeEditor) return;
      activeEditor.target = saved;
      activeEditor.dirty = false;
      activeEditor.saving = false;
      if (saved.state === "ready") {
        navigation.backToSources(saved.id);
        return;
      }
      if (api.previewTargetInitialization) {
        const preview = await api.previewTargetInitialization(saved.id);
        if (!isActive() || editor !== activeEditor) return;
        activeEditor.initialization = { files: preview.files };
      }
      render();
    }).catch((error) => {
      if (!isActive() || editor !== activeEditor) return;
      editor = targetEditorSaveFailed(activeEditor, errorMessage(error, "发布配置无法保存"));
      render();
    });
  });
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "back-to-sources" || action === "cancel-edit") {
      if (editor) back();
      else navigation.backToSources(targetId);
      return;
    }
    if (!editor) return;
    if (action === "confirm-target-initialization" && api.initializeTarget && editor.initialization) {
      if (!window.confirm("确认创建预览中的发布目录和配置文件吗？")) return;
      const activeEditor = editor;
      activeEditor.saving = true;
      activeEditor.error = undefined;
      render();
      void api.initializeTarget(activeEditor.target.id).then((saved) => {
        if (!isActive() || editor !== activeEditor) return;
        navigation.backToSources(saved.id);
      }).catch((error) => {
        if (!isActive() || editor !== activeEditor) return;
        activeEditor.saving = false;
        activeEditor.error = errorMessage(error, "发布目录无法初始化");
        render();
      });
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (!editor || !(input instanceof HTMLSelectElement) || input.name !== "adapter") return;
    const candidate = editor.candidates.find((item) => item.adapter === input.value);
    if (!candidate) return;
    editor.form = {
      adapter: candidate.adapter,
      postsDirectory: candidate.posts_directory,
      resourcesDirectory: candidate.resources_directory,
    };
    editor.initialization = undefined;
    editor.dirty = true;
    render();
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (!editor || !(input instanceof HTMLInputElement)) return;
    const field = input.name === "posts-directory"
      ? "postsDirectory"
      : input.name === "resources-directory"
        ? "resourcesDirectory"
        : undefined;
    if (!field) return;
    const hadInitialization = Boolean(editor.initialization);
    editor = targetEditorDirectoryChanged(editor, field, input.value);
    if (hadInitialization) render();
  });
  render();
  void (api.listTargets?.() ?? Promise.resolve([])).then(async (targets) => {
    if (!isActive()) return;
    const target = targets.find((item) => item.id === targetId);
    if (!target) {
      root.innerHTML = '<section class="focused-editor-page"><p class="editor-error" role="alert">未找到 GitHub 目标。</p><button type="button" data-action="back-to-sources">返回内容来源</button></section>';
      return;
    }
    const candidates = await (api.inspectTargetConfiguration?.(target.id) ?? Promise.resolve([]));
    if (!isActive()) return;
    const selected = candidates.find((candidate) => candidate.adapter === target.adapter) ?? candidates[0];
    editor = {
      target,
      candidates,
      form: {
        adapter: target.adapter ?? selected?.adapter ?? "github_pages",
        postsDirectory: target.adapter ? target.layout.posts_directory : selected?.posts_directory ?? target.layout.posts_directory,
        resourcesDirectory: target.adapter ? target.layout.resources_directory : selected?.resources_directory ?? target.layout.resources_directory,
      },
      dirty: false,
      saving: false,
    };
    render();
  }).catch((error) => {
    root.innerHTML = `<section class="focused-editor-page"><p class="editor-error" role="alert">${escapeHtml(errorMessage(error, "发布目标无法加载"))}</p><button type="button" data-action="back-to-sources">返回内容来源</button></section>`;
  });
}
