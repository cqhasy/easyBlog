import { listChanges, scanScope } from "../../bridge/changes";
import { listScopes } from "../../bridge/sources";
import type { Change, ChangeKind, ScopeId, ScopeSummary } from "../../contracts";

export const changesFeature = "changes";

export type ChangesApi = {
  listScopes: () => Promise<ScopeSummary[]>;
  scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
  listChanges: (scopeId: ScopeId) => Promise<Change[]>;
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
  return selectableChanges(changes).filter((change) => change.selected);
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
  if (change.kind === "deleted") return "删除需要在发布前再次确认";
  return change.source_path;
}

function renderChangeRow(change: Change, checked: boolean): string {
  const disabled = change.kind === "blocked" ? "disabled" : "";
  const selection = checked ? "checked" : "";
  const title = change.title ?? change.source_path.split("/").at(-1) ?? "未命名内容";
  return `<li class="change-row change-${change.kind}"><label class="change-select"><input type="checkbox" data-change-id="${escapeHtml(change.id)}" ${selection} ${disabled} /><span class="visually-hidden">选择 ${escapeHtml(title)}</span></label><div class="change-main"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(change.source_path)}</span></div><span class="change-note">${escapeHtml(changeNote(change))}</span></li>`;
}

function renderGroups(changes: Change[], selected: Set<string>): string {
  return groupChanges(changes).map(({ kind, changes: items }) => `<section class="change-group change-group-${kind}"><header><h2>${groupLabels[kind]}</h2><span>${items.length}</span></header><ul>${items.map((change) => renderChangeRow(change, selected.has(change.id))).join("")}</ul></section>`).join("");
}

export function renderChanges(state: ChangesState, selected = new Set<string>(), scanning = false, scopes: ScopeSummary[] = []): string {
  const header = `<header class="changes-header"><div><p class="eyebrow">EASYBLOG / REVIEW</p><h1 id="changes-title">待发布变更</h1><p>先检测，再确认这一次要发布的内容。</p></div></header>`;
  if (state.status === "loading") return `<main class="changes-page" aria-labelledby="changes-title">${header}<p class="changes-loading" role="status">正在整理待发布内容...</p></main>`;
  if (state.status === "error") return `<main class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-message" role="alert"><strong>暂时无法打开变更清单</strong><p>${escapeHtml(state.message)}</p><button type="button" data-action="retry">重试</button></section></main>`;
  if (state.status === "needs_scope") return `<main class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-empty"><span class="empty-mark" aria-hidden="true">+</span><h2>先添加一个同步范围</h2><p>范围确定了 easyBlog 要检查哪些内容。</p></section></main>`;
  const changeCount = state.status === "ready" ? state.changes.length : 0;
  const selectedCount = state.status === "ready" ? state.changes.filter((change) => selected.has(change.id)).length : 0;
  const body = state.status === "empty" ? `<section class="changes-empty"><span class="empty-mark" aria-hidden="true">✓</span><h2>没有待发布变更</h2><p>上次检测：${escapeHtml(formatScanTime(state.scannedAt))}</p></section>` : `<div class="changes-list">${renderGroups(state.changes, selected)}</div>`;
  const scopeOptions = (scopes.length ? scopes : [state.scope]).map((summary) => `<option value="${escapeHtml(summary.scope.id)}" ${summary.scope.id === state.scope.scope.id ? "selected" : ""}>${escapeHtml(summary.scope.name)}</option>`).join("");
  return `<main class="changes-page" aria-labelledby="changes-title">${header}<section class="changes-toolbar" aria-label="检测控制"><div><label for="changes-scope">检测范围</label><select id="changes-scope" data-action="change-scope" ${scanning ? "disabled" : ""}>${scopeOptions}</select><span>${changeCount ? `发现 ${changeCount} 项待确认变更` : "检查此范围的新变化"}</span></div><button type="button" data-action="scan" ${scanning ? "disabled" : ""}>${scanning ? "正在检测..." : "立即检测"}</button></section>${body}<footer class="selection-bar ${selectedCount ? "selection-active" : ""}"><span>${selectedCount ? `已选择 ${selectedCount} 项` : "选择变更后可预览发布"}</span><button type="button" data-action="preview" ${selectedCount ? "" : "disabled"}>预览发布</button></footer></main>`;
}

export type ChangesController = { refresh: () => void };

export function mountChanges(root: HTMLElement, api: ChangesApi = { listScopes, scanScope, listChanges }): ChangesController {
  let state: ChangesState = { status: "loading" };
  let selected = new Set<string>();
  let scanning = false;
  let scopes: ScopeSummary[] = [];
  let refreshGeneration = 0;
  const render = () => { root.innerHTML = renderChanges(state, selected, scanning, scopes); };
  const refresh = async (requestedScopeId?: ScopeId) => {
    const generation = ++refreshGeneration;
    state = { status: "loading" };
    render();
    try {
      const nextScopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
      if (!nextScopes.length) state = { status: "needs_scope" };
      else {
        const scope = nextScopes.find((summary) => summary.scope.id === requestedScopeId) ?? nextScopes[0];
        const changes = await api.listChanges(scope.scope.id);
        if (generation !== refreshGeneration) return;
        scopes = nextScopes;
        state = changes.length ? { status: "ready", scope, changes } : { status: "empty", scope };
      }
    } catch (error) {
      if (generation !== refreshGeneration) return;
      state = { status: "error", message: errorMessage(error, "变更列表暂时无法读取") };
    }
    if (generation !== refreshGeneration) return;
    if (state.status === "ready") selected = new Set(defaultSelectedChanges(state.changes).map((change) => change.id));
    render();
  };
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "retry") { void refresh(); return; }
    if (action === "scan" && (state.status === "ready" || state.status === "empty") && !scanning) {
      const scope = state.scope;
      scanning = true;
      render();
      void api.scanScope(scope.scope.id).then((result) => {
        state = result.changes.length ? { status: "ready", scope, changes: result.changes, scannedAt: result.scanned_at } : { status: "empty", scope, scannedAt: result.scanned_at };
        selected = new Set(defaultSelectedChanges(result.changes).map((change) => change.id));
      }).catch((error) => { state = { status: "error", message: errorMessage(error, "检测没有完成") }; }).finally(() => { scanning = false; render(); });
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
