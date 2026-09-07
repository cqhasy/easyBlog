import { listChanges, scanScope } from "../../bridge/changes";
import { listScopes } from "../../bridge/sources";
import { listTargets } from "../../bridge/targets";
import type { Change, ChangeKind, ConnectedTarget, ScopeId, ScopeSummary } from "../../contracts";

export const changesFeature = "changes";

export type ChangesApi = {
  listScopes: () => Promise<ScopeSummary[]>;
  scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
  listChanges: (scopeId: ScopeId) => Promise<Change[]>;
  listTargets?: () => Promise<ConnectedTarget[]>;
};

export type ChangesNavigation = {
  openReview: (context: {
    scopeId: ScopeId;
    selectedChangeIds: string[];
    activeChangeId: string;
  }) => void;
  openSources: () => void;
  backToDashboard: () => void;
};

export type ChangesState =
  | { status: "loading" }
  | { status: "needs_scope" }
  | { status: "empty"; scope: ScopeSummary; scannedAt?: string }
  | { status: "ready"; scope: ScopeSummary; changes: Change[]; scannedAt?: string }
  | { status: "error"; message: string };

const groupOrder: ChangeKind[] = ["blocked", "added", "updated", "moved", "deleted"];
const groupLabels: Record<ChangeKind, string> = {
  added: "新增", updated: "更新", moved: "移动", deleted: "删除", blocked: "需要处理",
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

function formatScanTime(value?: string): string {
  if (!value) return "尚未检测";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

export function selectableChanges(changes: Change[]): Change[] {
  return changes.filter((change) => change.kind !== "blocked");
}

export function defaultSelectedChanges(changes: Change[]): Change[] {
  return selectableChanges(changes).filter((change) => change.kind !== "deleted" && change.selected);
}

export function reconcileSelectedChangeIds(selectedIds: Set<string>, changes: Change[]): Set<string> {
  const availableIds = new Set(selectableChanges(changes).map((change) => change.id));
  return new Set([...selectedIds].filter((id) => availableIds.has(id)));
}

export function groupChanges(changes: Change[]): Array<{ kind: ChangeKind; changes: Change[] }> {
  return groupOrder.map((kind) => ({ kind, changes: changes.filter((change) => change.kind === kind) })).filter((group) => group.changes.length > 0);
}

export type ChangeTreeNode =
  | { type: "folder"; id: string; name: string; children: ChangeTreeNode[] }
  | { type: "file"; change: Change };

type MutableChangeFolder = { type: "folder"; id: string; name: string; children: ChangeTreeNode[] };

export function buildChangeTree(changes: Change[]): ChangeTreeNode[] {
  const root: MutableChangeFolder = { type: "folder", id: "root", name: "", children: [] };
  const folders = new Map<string, MutableChangeFolder>([["", root]]);
  for (const change of changes) {
    const parts = change.source_path.replaceAll("\\", "/").split("/").filter(Boolean);
    let parent = root;
    const path: string[] = [];
    for (const part of parts.slice(0, -1)) {
      path.push(part);
      const key = path.join("/");
      let folder = folders.get(key);
      if (!folder) {
        folder = { type: "folder", id: `folder:${key}`, name: part, children: [] };
        folders.set(key, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ type: "file", change });
  }
  const sortNodes = (nodes: ChangeTreeNode[]): ChangeTreeNode[] => {
    for (const node of nodes) if (node.type === "folder") node.children = sortNodes(node.children);
    return nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      const leftName = left.type === "folder" ? left.name : left.change.source_path;
      const rightName = right.type === "folder" ? right.name : right.change.source_path;
      return leftName.localeCompare(rightName, "zh-CN");
    });
  };
  return sortNodes(root.children);
}

function treeSelectableIds(nodes: ChangeTreeNode[]): string[] {
  return nodes.flatMap((node) => node.type === "file"
    ? (node.change.kind === "blocked" ? [] : [node.change.id])
    : treeSelectableIds(node.children));
}

export function changeTreeSelectionState(nodes: ChangeTreeNode[], selected: Set<string>): "checked" | "mixed" | "unchecked" {
  const ids = treeSelectableIds(nodes);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  if (ids.length && selectedCount === ids.length) return "checked";
  return selectedCount ? "mixed" : "unchecked";
}

export async function loadChanges(api: ChangesApi, requestedScopeId?: ScopeId): Promise<ChangesState> {
  try {
    const scopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
    if (!scopes.length) return { status: "needs_scope" };
    const scope = scopes.find((item) => item.scope.id === requestedScopeId) ?? scopes[0];
    const changes = await api.listChanges(scope.scope.id);
    return changes.length ? { status: "ready", scope, changes } : { status: "empty", scope };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "变更列表暂时无法读取") };
  }
}

function changeNote(change: Change): string {
  if (change.kind === "blocked") return change.blocked_reason ?? "此内容暂不能发布";
  if (change.kind === "moved") return `原路径：${change.previous_path ?? "未知"}`;
  if (change.kind === "deleted") return "删除需要在评审中确认";
  return change.source_path;
}

function changeLabel(kind: ChangeKind): string {
  return groupLabels[kind];
}

function fileDisplayName(sourcePath: string): string {
  const fileName = sourcePath.replaceAll("\\", "/").split("/").at(-1) ?? "未命名文件";
  return fileName.replace(/\.md$/i, "") || fileName;
}

function renderChangeRow(change: Change, checked: boolean, depth: number): string {
  const disabled = change.kind === "blocked" ? "disabled" : "";
  const selection = checked ? "checked" : "";
  const fileName = fileDisplayName(change.source_path);
  const articleTitle = change.title && change.title !== fileName ? change.title : "";
  const review = change.kind === "blocked"
    ? `<span class="change-unavailable">不可用</span>`
    : `<button type="button" class="change-review-button" data-action="open-review" data-change-id="${escapeHtml(change.id)}" aria-label="评审 ${escapeHtml(fileName)}">评审</button>`;
  const articleTitleMarkup = articleTitle ? `<span class="change-article-title">${escapeHtml(articleTitle)}</span>` : "";
  return `<li class="change-tree-row change-${change.kind}" style="--tree-depth:${depth}"><label class="change-select"><input type="checkbox" data-change-id="${escapeHtml(change.id)}" ${selection} ${disabled} /><span class="visually-hidden">选择 ${escapeHtml(fileName)}</span></label><div class="change-tree-main"><i data-lucide="file-text" aria-hidden="true"></i><strong>${escapeHtml(fileName)}</strong><span class="change-kind change-kind-${change.kind}">${changeLabel(change.kind)}</span>${articleTitleMarkup}</div><span class="change-note">${escapeHtml(changeNote(change))}</span>${review}</li>`;
}

function renderTreeCheckbox(ids: string[], state: "checked" | "mixed" | "unchecked", label: string): string {
  const disabled = ids.length ? "" : "disabled";
  const checked = state === "checked" ? "checked" : "";
  const mixed = state === "mixed" ? 'data-indeterminate="true"' : "";
  return `<label class="change-select change-tree-select"><input type="checkbox" data-action="toggle-tree-selection" data-change-ids="${escapeHtml(JSON.stringify(ids))}" ${checked} ${disabled} ${mixed} aria-label="选择 ${escapeHtml(label)} 中的文件" /><span class="visually-hidden">选择 ${escapeHtml(label)} 中的文件</span></label>`;
}

function treeSelectionIds(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const ids: unknown = JSON.parse(value);
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : [];
  } catch {
    return [];
  }
}

function renderChangeTree(nodes: ChangeTreeNode[], selected: Set<string>, collapsed: Set<string>, depth = 0): string {
  return nodes.map((node) => {
    if (node.type === "file") return renderChangeRow(node.change, selected.has(node.change.id), depth);
    const isCollapsed = collapsed.has(node.id);
    const children = isCollapsed ? "" : renderChangeTree(node.children, selected, collapsed, depth + 1);
    const ids = treeSelectableIds(node.children);
    const selectionState = changeTreeSelectionState(node.children, selected);
    return `<li class="change-tree-folder" style="--tree-depth:${depth}">${renderTreeCheckbox(ids, selectionState, node.name)}<button type="button" class="change-tree-toggle" data-action="toggle-folder" data-folder-id="${escapeHtml(node.id)}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? "展开" : "收起"} ${escapeHtml(node.name)}"><i data-lucide="chevron-right" aria-hidden="true"></i></button><span class="change-tree-main"><i data-lucide="folder" aria-hidden="true"></i><strong>${escapeHtml(node.name)}</strong></span></li>${children}`;
  }).join("");
}

export function renderChanges(state: ChangesState, selected = new Set<string>(), scanning = false, scopes: ScopeSummary[] = [], collapsed = new Set<string>()): string {
  const header = `<header class="changes-header"><button type="button" class="back-button changes-back-button" data-action="back-to-dashboard" aria-label="返回 Dashboard" title="返回 Dashboard"><i data-lucide="arrow-left" aria-hidden="true"></i></button><div><p class="eyebrow">发布评审</p><h1 id="changes-title">待发布变更</h1><p>先检测，再选择本次需要评审的内容。</p></div></header>`;
  if (state.status === "loading") return `<section class="changes-page" aria-labelledby="changes-title">${header}<p class="changes-loading" role="status">正在整理待发布内容...</p></section>`;
  if (state.status === "error") return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-message" role="alert"><strong>暂时无法打开变更清单</strong><p>${escapeHtml(state.message)}</p><button type="button" data-action="retry">重试</button></section></section>`;
  if (state.status === "needs_scope") return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-empty"><span class="empty-mark" aria-hidden="true">+</span><h2>先添加一个同步范围</h2><p>范围确定了 easyBlog 要检查哪些内容。</p></section></section>`;

  const changeCount = state.status === "ready" ? state.changes.length : 0;
  const selectedChanges = state.status === "ready" ? state.changes.filter((change) => selected.has(change.id)) : [];
  const body = state.status === "empty"
    ? `<section class="changes-empty"><span class="empty-mark" aria-hidden="true">+</span><h2>没有待发布变更</h2><p>上次检测：${escapeHtml(formatScanTime(state.scannedAt))}</p></section>`
    : (() => {
      const tree = buildChangeTree(state.changes);
      const ids = treeSelectableIds(tree);
      return `<section class="changes-list" aria-labelledby="changes-list-title"><header class="changes-list-header"><div><h2 id="changes-list-title">待确认内容</h2><p>按来源目录浏览，选择需要进入评审的文件。</p></div></header><ul class="change-tree" role="tree"><li class="change-tree-root">${renderTreeCheckbox(ids, changeTreeSelectionState(tree, selected), state.scope.scope.name)}<i data-lucide="folder" aria-hidden="true"></i><strong>${escapeHtml(state.scope.scope.name)}</strong><span>${changeCount} 项待确认</span></li>${renderChangeTree(tree, selected, collapsed)}</ul></section>`;
    })();
  const scopeOptions = (scopes.length ? scopes : [state.scope]).map((summary) => `<option value="${escapeHtml(summary.scope.id)}" ${summary.scope.id === state.scope.scope.id ? "selected" : ""}>${escapeHtml(summary.scope.name)}</option>`).join("");
  const operation = scanning
    ? '<p class="changes-operation" role="status" aria-live="polite">正在检测变更...</p>'
    : "";
  const selectionAction = `<span class="changes-selected">已选择 ${selectedChanges.length} 项</span><button type="button" class="review-primary-button" data-action="open-review" ${selectedChanges.length ? "" : "disabled"}>进入评审</button>`;
  return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-toolbar" aria-label="检测与评审控制"><div><label for="changes-scope">同步范围</label><select id="changes-scope" data-action="change-scope" ${scanning ? "disabled" : ""}>${scopeOptions}</select><span>${changeCount ? `${changeCount} 项待确认 · ${formatScanTime(state.scannedAt)}` : "检查此范围的新变化"}</span></div><div class="changes-toolbar-actions">${operation}<button type="button" class="icon-button changes-scan-button" data-action="scan" ${scanning ? "disabled" : ""} aria-label="重新检测" title="重新检测"><i data-lucide="refresh-cw" aria-hidden="true"></i></button>${selectionAction}</div></section>${body}</section>`;
}

export type ChangesController = { refresh: () => void };

type ChangesRefreshController = {
  refresh: (requestedScopeId?: ScopeId) => Promise<void>;
  begin: () => number;
  isCurrent: (generation: number) => boolean;
};

export function createChangesRefreshController(
  api: ChangesApi,
  apply: (state: ChangesState, scopes: ScopeSummary[]) => void,
): ChangesRefreshController {
  let generation = 0;
  const begin = () => ++generation;
  const isCurrent = (requestGeneration: number) => requestGeneration === generation;
  const refresh = async (requestedScopeId?: ScopeId) => {
    const currentGeneration = begin();
    apply({ status: "loading" }, []);
    try {
      const scopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
      if (!scopes.length) {
        if (isCurrent(currentGeneration)) apply({ status: "needs_scope" }, []);
        return;
      }
      const scope = scopes.find((summary) => summary.scope.id === requestedScopeId) ?? scopes[0];
      const changes = await api.listChanges(scope.scope.id);
      if (isCurrent(currentGeneration)) apply(changes.length ? { status: "ready", scope, changes } : { status: "empty", scope }, scopes);
    } catch (error) {
      if (isCurrent(currentGeneration)) apply({ status: "error", message: errorMessage(error, "变更列表暂时无法读取") }, []);
    }
  };
  return { refresh, begin, isCurrent };
}

export function mountChanges(
  root: HTMLElement,
  api: ChangesApi = { listScopes, scanScope, listChanges, listTargets },
  navigation: ChangesNavigation,
  initialContext: { scopeId?: ScopeId; selectedChangeIds?: string[] } = {},
  onRendered: () => void = () => undefined,
): ChangesController {
  let state: ChangesState = { status: "loading" };
  let selected = new Set(initialContext.selectedChangeIds);
  let scanning = false;
  let scopes: ScopeSummary[] = [];
  const collapsedFolders = new Set<string>();
  let currentScopeId = initialContext.scopeId;
  let selectedScopeId = initialContext.selectedChangeIds ? initialContext.scopeId : undefined;
  const render = () => {
    root.innerHTML = renderChanges(state, selected, scanning, scopes, collapsedFolders);
    (root as Partial<HTMLElement>).querySelectorAll?.('input[data-indeterminate="true"]').forEach((input) => {
      (input as HTMLInputElement).indeterminate = true;
    });
    onRendered();
  };
  const refreshController = createChangesRefreshController(api, (nextState, nextScopes) => {
    state = nextState;
    scopes = nextScopes;
    if (state.status === "ready" || state.status === "empty") {
      currentScopeId = state.scope.scope.id;
      if (state.status === "ready") {
        selected = selectedScopeId === currentScopeId
          ? reconcileSelectedChangeIds(selected, state.changes)
          : new Set(defaultSelectedChanges(state.changes).map((change) => change.id));
        selectedScopeId = currentScopeId;
      } else {
        selected.clear();
        selectedScopeId = currentScopeId;
      }
    }
    render();
  });
  const refresh = async (requestedScopeId?: ScopeId) => {
    await refreshController.refresh(requestedScopeId ?? currentScopeId);
  };
  const openReview = (activeChangeId?: string) => {
    if (state.status !== "ready" || !selected.size) return;
    const changesById = new Map(selectableChanges(state.changes).map((change) => [change.id, change]));
    const selectedChanges = [...selected].flatMap((id) => {
      const change = changesById.get(id);
      return change ? [change] : [];
    });
    const activeId = activeChangeId && selected.has(activeChangeId) ? activeChangeId : selectedChanges[0]?.id;
    if (!activeId) return;
    navigation.openReview({
      scopeId: state.scope.scope.id,
      selectedChangeIds: selectedChanges.map((change) => change.id),
      activeChangeId: activeId,
    });
  };

  root.addEventListener("click", (event) => {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = actionElement?.dataset.action;
    if (action === "back-to-dashboard") { navigation.backToDashboard(); return; }
    if (action === "retry") { void refresh(); return; }
    if (action === "toggle-folder") {
      const folderId = actionElement?.dataset.folderId;
      if (folderId) {
        if (collapsedFolders.has(folderId)) collapsedFolders.delete(folderId); else collapsedFolders.add(folderId);
        render();
      }
      return;
    }
    if (action === "open-review" && state.status === "ready") {
      const changeId = actionElement?.dataset.changeId;
      if (changeId) selected.add(changeId);
      openReview(changeId);
      return;
    }
    if (action === "scan" && (state.status === "ready" || state.status === "empty") && !scanning) {
      const scope = state.scope;
      const scanGeneration = refreshController.begin();
      scanning = true;
      render();
      void api.scanScope(scope.scope.id).then((result) => {
        if (!refreshController.isCurrent(scanGeneration)) return;
        state = result.changes.length ? { status: "ready", scope, changes: result.changes, scannedAt: result.scanned_at } : { status: "empty", scope, scannedAt: result.scanned_at };
        currentScopeId = scope.scope.id;
        selected = reconcileSelectedChangeIds(selected, result.changes);
      }).catch((error) => {
        if (refreshController.isCurrent(scanGeneration)) state = { status: "error", message: errorMessage(error, "检测没有完成") };
      }).finally(() => { scanning = false; render(); });
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.dataset.action === "change-scope") { void refresh(input.value); return; }
    if (input instanceof HTMLInputElement && input.dataset.action === "toggle-tree-selection" && state.status === "ready") {
      const ids = treeSelectionIds(input.dataset.changeIds);
      for (const id of ids) {
        if (input.checked) selected.add(id); else selected.delete(id);
      }
      render();
      return;
    }
    if (!(input instanceof HTMLInputElement) || !input.dataset.changeId) return;
    if (input.checked) selected.add(input.dataset.changeId); else selected.delete(input.dataset.changeId);
    render();
  });
  void refresh();
  return { refresh: () => { void refresh(); } };
}
