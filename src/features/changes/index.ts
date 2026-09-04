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

function renderChangeRow(change: Change, checked: boolean): string {
  const disabled = change.kind === "blocked" ? "disabled" : "";
  const selection = checked ? "checked" : "";
  const title = change.title ?? change.source_path.split("/").at(-1) ?? "未命名内容";
  const review = change.kind === "blocked"
    ? `<span class="change-unavailable">不可用</span>`
    : `<button type="button" class="change-review-button" data-action="open-review" data-change-id="${escapeHtml(change.id)}" aria-label="评审 ${escapeHtml(title)}">评审</button>`;
  return `<li class="change-row change-${change.kind}"><label class="change-select"><input type="checkbox" data-change-id="${escapeHtml(change.id)}" ${selection} ${disabled} /><span class="visually-hidden">选择 ${escapeHtml(title)}</span></label><div class="change-main"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(change.source_path)}</span></div><span class="change-note">${escapeHtml(changeNote(change))}</span>${review}</li>`;
}

function renderGroups(changes: Change[], selected: Set<string>): string {
  return groupChanges(changes).map(({ kind, changes: items }) => `<section class="change-group change-group-${kind}"><header><h2>${groupLabels[kind]}</h2><span>${items.length}</span></header><ul>${items.map((change) => renderChangeRow(change, selected.has(change.id))).join("")}</ul></section>`).join("");
}

export function renderChanges(state: ChangesState, selected = new Set<string>(), scanning = false, scopes: ScopeSummary[] = []): string {
  const header = `<header class="changes-header"><div><p class="eyebrow">发布评审</p><h1 id="changes-title">待发布变更</h1><p>先检测，再选择本次需要评审的内容。</p></div></header>`;
  if (state.status === "loading") return `<section class="changes-page" aria-labelledby="changes-title">${header}<p class="changes-loading" role="status">正在整理待发布内容...</p></section>`;
  if (state.status === "error") return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-message" role="alert"><strong>暂时无法打开变更清单</strong><p>${escapeHtml(state.message)}</p><button type="button" data-action="retry">重试</button></section></section>`;
  if (state.status === "needs_scope") return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-empty"><span class="empty-mark" aria-hidden="true">+</span><h2>先添加一个同步范围</h2><p>范围确定了 easyBlog 要检查哪些内容。</p></section></section>`;

  const changeCount = state.status === "ready" ? state.changes.length : 0;
  const selectedChanges = state.status === "ready" ? state.changes.filter((change) => selected.has(change.id)) : [];
  const body = state.status === "empty"
    ? `<section class="changes-empty"><span class="empty-mark" aria-hidden="true">+</span><h2>没有待发布变更</h2><p>上次检测：${escapeHtml(formatScanTime(state.scannedAt))}</p></section>`
    : `<div class="changes-list">${renderGroups(state.changes, selected)}</div>`;
  const scopeOptions = (scopes.length ? scopes : [state.scope]).map((summary) => `<option value="${escapeHtml(summary.scope.id)}" ${summary.scope.id === state.scope.scope.id ? "selected" : ""}>${escapeHtml(summary.scope.name)}</option>`).join("");
  const selectionAction = selectedChanges.length
    ? `<footer class="selection-region" aria-label="已选变更操作"><span>已选择 ${selectedChanges.length} 项</span><button type="button" class="review-primary-button" data-action="open-review">进入评审</button></footer>`
    : "";
  const operation = scanning
    ? '<p class="changes-operation" role="status" aria-live="polite">正在检测变更...</p>'
    : "";
  return `<section class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-toolbar" aria-label="检测控制"><div><label for="changes-scope">检测范围</label><select id="changes-scope" data-action="change-scope" ${scanning ? "disabled" : ""}>${scopeOptions}</select><span>${changeCount ? `发现 ${changeCount} 项待确认变更` : "检查此范围的新变化"}</span></div><div class="changes-toolbar-actions">${operation}<button type="button" data-action="scan" ${scanning ? "disabled" : ""}>${scanning ? "正在检测..." : "立即检测"}</button></div></section>${body}${selectionAction}</section>`;
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
): ChangesController {
  let state: ChangesState = { status: "loading" };
  let selected = new Set(initialContext.selectedChangeIds);
  let scanning = false;
  let scopes: ScopeSummary[] = [];
  let currentScopeId = initialContext.scopeId;
  let selectedScopeId = initialContext.selectedChangeIds ? initialContext.scopeId : undefined;
  const render = () => { root.innerHTML = renderChanges(state, selected, scanning, scopes); };
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
    if (action === "retry") { void refresh(); return; }
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
    if (!(input instanceof HTMLInputElement) || !input.dataset.changeId) return;
    if (input.checked) selected.add(input.dataset.changeId); else selected.delete(input.dataset.changeId);
    render();
  });
  void refresh();
  return { refresh: () => { void refresh(); } };
}
