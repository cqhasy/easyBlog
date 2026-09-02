import { listChanges, scanScope } from "../../bridge/changes";
import { previewRelease, publishRelease } from "../../bridge/releases";
import { listScopes } from "../../bridge/sources";
import { listTargets } from "../../bridge/targets";
import type { Change, ChangeKind, ConnectedTarget, Publication, ReleasePlan, ScopeId, ScopeSummary, Target } from "../../contracts";

export const changesFeature = "changes";

export type ChangesApi = {
  listScopes: () => Promise<ScopeSummary[]>;
  scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
  listChanges: (scopeId: ScopeId) => Promise<Change[]>;
  listTargets?: () => Promise<ConnectedTarget[]>;
  previewRelease?: (input: { scope_id: ScopeId; target: Target; change_ids: string[] }) => Promise<ReleasePlan>;
  publishRelease?: (input: { scope_id: ScopeId; target: Target; change_ids: string[] }) => Promise<Publication>;
};

export type ChangesState =
  | { status: "loading" }
  | { status: "needs_scope" }
  | { status: "empty"; scope: ScopeSummary; scannedAt?: string }
  | { status: "ready"; scope: ScopeSummary; changes: Change[]; scannedAt?: string }
  | { status: "error"; message: string };

type ReleaseState =
  | { status: "idle" }
  | { status: "configure" }
  | { status: "previewing" }
  | { status: "preview"; plan: ReleasePlan; target: Target }
  | { status: "publishing"; plan: ReleasePlan; target: Target }
  | { status: "published"; publication: Publication }
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

function renderReleasePanel(release: ReleaseState, connectedTarget: ConnectedTarget | undefined, selectedCount: number, targetId?: string | null): string {
  if (release.status === "idle") return "";
  if (release.status === "published") return `<section class="release-panel" role="status"><header><div><p class="eyebrow">EASYBLOG / PUBLISHED</p><h2>发布已推送</h2></div><button type="button" class="icon-button close-button" data-action="close-release" aria-label="关闭发布结果">×</button></header><p>提交 <code>${escapeHtml(release.publication.commit_sha)}</code> 已推送到远程仓库。</p><button type="button" data-action="finish-release">返回变更列表</button></section>`;
  const error = release.status === "error" ? `<p class="release-error" role="alert">${escapeHtml(release.message)}</p>` : "";
  const disabled = !connectedTarget || !targetId || release.status === "previewing" || release.status === "publishing";
  const plan = release.status === "preview" || release.status === "publishing" ? release.plan : undefined;
  const previewTarget = release.status === "preview" || release.status === "publishing" ? release.target : undefined;
  const diffs = plan ? `<div class="release-diffs">${plan.diffs.map((diff) => `<article class="release-diff"><header><strong>${escapeHtml(diff.path)}</strong><span class="diff-kind diff-${diff.kind}">${escapeHtml(diff.kind)}</span></header><pre>${escapeHtml(diff.patch)}</pre></article>`).join("")}</div>` : "";
  return `<section class="release-panel" aria-labelledby="release-title"><header><div><p class="eyebrow">EASYBLOG / RELEASE</p><h2 id="release-title">${plan ? "确认发布内容" : "预览发布"}</h2></div><button type="button" class="icon-button close-button" data-action="close-release" aria-label="关闭发布预览">×</button></header><p class="release-intro">本次将处理 ${selectedCount} 项变更。发布前会再次检查 Git 工作区是否干净。</p>${connectedTarget ? `<p class="release-target"><strong>${escapeHtml(connectedTarget.name)}</strong><span>${escapeHtml(previewTarget?.workspace_path ?? connectedTarget.workspace_path)}</span></p>` : ""}${targetId ? connectedTarget ? "" : "<p class=\"release-error\">找不到当前范围绑定的发布目标，请重新绑定范围。</p>" : "<p class=\"release-error\">当前范围尚未绑定发布目标。</p>"}${error}${plan ? `<p class="release-summary">${plan.diffs.length} 个目标文件${plan.needs_configuration ? "，包含首次发布配置" : ""}。</p>${diffs}<footer><button type="button" class="secondary-button" data-action="close-release" ${release.status === "publishing" ? "disabled" : ""}>返回修改</button><button type="button" data-action="publish" ${release.status === "publishing" ? "disabled" : ""}>${release.status === "publishing" ? "正在提交并推送..." : "确认发布"}</button></footer>` : `<footer><button type="button" class="secondary-button" data-action="close-release">取消</button><button type="button" data-action="run-preview" ${disabled ? "disabled" : ""}>${release.status === "previewing" ? "正在生成预览..." : "生成预览"}</button></footer>`}</section>`;
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

export function mountChanges(root: HTMLElement, api: ChangesApi = { listScopes, scanScope, listChanges, listTargets, previewRelease, publishRelease }): ChangesController {
  let state: ChangesState = { status: "loading" };
  let selected = new Set<string>();
  let scanning = false;
  let scopes: ScopeSummary[] = [];
  let currentScopeId: ScopeId | undefined;
  let release: ReleaseState = { status: "idle" };
  let targets: ConnectedTarget[] = [];
  let releaseGeneration = 0;
  const activeScope = () => state.status === "ready" || state.status === "empty" ? state.scope : undefined;
  const invalidateRelease = () => {
    releaseGeneration += 1;
    release = { status: "idle" };
  };
  const render = () => {
    const scope = activeScope();
    const target = targets.find((item) => item.id === scope?.scope.target_id);
    root.innerHTML = renderChanges(state, selected, scanning, scopes) + renderReleasePanel(release, target, selected.size, scope?.scope.target_id);
  };
  const refreshController = createChangesRefreshController(api, (nextState, nextScopes) => {
    state = nextState;
    scopes = nextScopes;
    if (state.status === "ready" || state.status === "empty") currentScopeId = state.scope.scope.id;
    if (state.status === "ready") selected = new Set(defaultSelectedChanges(state.changes).map((change) => change.id));
    render();
  });
  const refresh = async (requestedScopeId?: ScopeId, preserveRelease = false) => {
    if (!preserveRelease) invalidateRelease();
    const [, loadedTargets] = await Promise.all([
      refreshController.refresh(requestedScopeId ?? currentScopeId),
      api.listTargets?.() ?? Promise.resolve([]),
    ]);
    targets = loadedTargets;
    render();
  };
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "retry") { void refresh(); return; }
    if (action === "close-release") { invalidateRelease(); render(); return; }
    if (action === "finish-release") { void refresh(); return; }
    if (action === "preview" && state.status === "ready") { invalidateRelease(); release = { status: "configure" }; render(); root.querySelector<HTMLInputElement>("#release-workspace")?.focus(); return; }
    if (action === "run-preview" && state.status === "ready" && api.previewRelease) {
      const targetId = state.scope.scope.target_id;
      const target = targets.find((item) => item.id === targetId);
      if (!target) { release = { status: "error", message: "当前范围的发布目标不可用，请在来源页重新连接或绑定。" }; render(); return; }
      const operationGeneration = ++releaseGeneration;
      release = { status: "previewing" }; render();
      void api.previewRelease({ scope_id: state.scope.scope.id, target, change_ids: [...selected] }).then((plan) => {
        if (operationGeneration !== releaseGeneration) return;
        release = { status: "preview", plan, target };
      }).catch((error) => {
        if (operationGeneration !== releaseGeneration) return;
        release = { status: "error", message: errorMessage(error, "发布预览没有完成") };
      }).finally(() => { if (operationGeneration === releaseGeneration) render(); });
      return;
    }
    if (action === "publish" && release.status === "preview" && api.publishRelease) {
      const { plan, target } = release;
      const operationGeneration = ++releaseGeneration;
      release = { status: "publishing", plan, target }; render();
      void api.publishRelease({ scope_id: plan.batch.scope_id, target, change_ids: plan.batch.change_ids }).then((publication) => {
        if (operationGeneration !== releaseGeneration) return;
        release = { status: "published", publication };
        selected.clear();
        void refresh(plan.batch.scope_id, true);
      }).catch((error) => {
        if (operationGeneration !== releaseGeneration) return;
        release = { status: "error", message: errorMessage(error, "发布没有完成") };
      }).finally(() => { if (operationGeneration === releaseGeneration) render(); });
      return;
    }
    if (action === "scan" && (state.status === "ready" || state.status === "empty") && !scanning) {
      const scope = state.scope;
      invalidateRelease();
      const scanGeneration = refreshController.begin();
      scanning = true;
      render();
      void api.scanScope(scope.scope.id).then((result) => {
        if (!refreshController.isCurrent(scanGeneration)) return;
        state = result.changes.length ? { status: "ready", scope, changes: result.changes, scannedAt: result.scanned_at } : { status: "empty", scope, scannedAt: result.scanned_at };
        currentScopeId = scope.scope.id;
        selected = new Set(defaultSelectedChanges(result.changes).map((change) => change.id));
      }).catch((error) => {
        if (refreshController.isCurrent(scanGeneration)) state = { status: "error", message: errorMessage(error, "检测没有完成") };
      }).finally(() => { scanning = false; render(); });
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.dataset.action === "change-scope") { void refresh(input.value); return; }
    if (!(input instanceof HTMLInputElement) || !input.dataset.changeId) return;
    invalidateRelease();
    if (input.checked) selected.add(input.dataset.changeId); else selected.delete(input.dataset.changeId);
    render();
  });
  void refresh();
  return { refresh: () => { void refresh(); } };
}
