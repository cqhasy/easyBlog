import { listChanges, scanScope } from "../../bridge/changes";
import { listPublications } from "../../bridge/releases";
import { listScopes } from "../../bridge/sources";
import type { Change, ChangeSet, PublicationRecord, ScopeId, ScopeSummary } from "../../contracts";

export type WorkbenchState =
  | { status: "loading" }
  | { status: "needs_scope" }
  | { status: "needs_target"; scopeName: string }
  | { status: "empty"; scopeName: string; scannedAt?: string; latestPublication: PublicationRecord | null }
  | {
      status: "ready";
      scopeName: string;
      pendingCount: number;
      scannedAt?: string;
      publicationState: "ready" | "needs_target" | "blocked";
      latestPublication: PublicationRecord | null;
    }
  | { status: "error"; message: string };

export type WorkbenchNavigation = {
  openChanges: (scopeId?: string) => void;
  openSources: () => void;
};

export type WorkbenchApi = {
  listScopes: () => Promise<ScopeSummary[]>;
  listChanges: (scopeId: ScopeId) => Promise<Change[]>;
  scanScope: (scopeId: ScopeId) => Promise<ChangeSet>;
  listPublications: () => Promise<PublicationRecord[]>;
};

type LoadedWorkbench = {
  state: WorkbenchState;
  scopeId?: ScopeId;
};

const defaultApi: WorkbenchApi = { listScopes, listChanges, scanScope, listPublications };

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

function formatTime(value?: string): string {
  if (!value) return "尚未检测";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function newestPublication(records: PublicationRecord[]): PublicationRecord | null {
  return [...records].sort((left, right) => {
    const leftTime = Date.parse(left.published_at ?? "") || 0;
    const rightTime = Date.parse(right.published_at ?? "") || 0;
    return rightTime - leftTime;
  })[0] ?? null;
}

async function loadWorkbenchContext(api: WorkbenchApi, scannedAt?: string): Promise<LoadedWorkbench> {
  try {
    const scopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
    if (!scopes.length) return { state: { status: "needs_scope" } };

    const scope = scopes[0];
    const [changes, publications] = await Promise.all([
      api.listChanges(scope.scope.id),
      api.listPublications(),
    ]);
    const latestPublication = newestPublication(publications);

    if (!scope.scope.target_id || scope.health === "needs_target") {
      return { state: { status: "needs_target", scopeName: scope.scope.name }, scopeId: scope.scope.id };
    }
    if (!changes.length) {
      return { state: { status: "empty", scopeName: scope.scope.name, scannedAt, latestPublication }, scopeId: scope.scope.id };
    }
    return {
      state: {
        status: "ready",
        scopeName: scope.scope.name,
        pendingCount: changes.length,
        scannedAt,
        publicationState: scope.health === "blocked" ? "blocked" : "ready",
        latestPublication,
      },
      scopeId: scope.scope.id,
    };
  } catch (error) {
    return { state: { status: "error", message: errorMessage(error, "工作台暂时无法读取") } };
  }
}

export async function loadWorkbench(api: WorkbenchApi): Promise<WorkbenchState> {
  return (await loadWorkbenchContext(api)).state;
}

function publicationSummary(publication: PublicationRecord | null): string {
  if (!publication) return "尚无发布记录";
  const time = formatTime(publication.published_at ?? undefined);
  const state = publication.state === "published" ? "已发布" : publication.state === "pending_push" ? "等待推送" : "需处理";
  return `${state} · ${publication.commit_sha} · ${time}`;
}

export function renderWorkbench(state: WorkbenchState, scanning = false): string {
  const header = `<header class="workbench-header"><div><p class="eyebrow">EASYBLOG / WORKBENCH</p><h1 id="workbench-title">工作台</h1></div></header>`;
  if (state.status === "loading") {
    return `<section class="workbench-page" aria-labelledby="workbench-title">${header}<p class="workbench-loading" role="status">正在整理当前工作...</p></section>`;
  }
  if (state.status === "needs_scope") {
    return `<section class="workbench-page" aria-labelledby="workbench-title">${header}<section class="workbench-status"><div><p class="workbench-kicker">开始设置</p><h2>先添加一个内容来源</h2><p>添加来源后，easyBlog 才能识别需要检查的文章。</p></div><button type="button" data-action="open-sources">前往来源</button></section></section>`;
  }
  if (state.status === "needs_target") {
    return `<section class="workbench-page" aria-labelledby="workbench-title">${header}<section class="workbench-status"><div><p class="workbench-kicker">发布准备</p><h2>${escapeHtml(state.scopeName)}还没有发布目标</h2><p>连接并配置 GitHub 目标后，就可以检查并确认变更。</p></div><button type="button" data-action="open-sources">配置来源</button></section></section>`;
  }
  if (state.status === "error") {
    return `<section class="workbench-page" aria-labelledby="workbench-title">${header}<section class="workbench-status workbench-status-error" role="alert"><div><p class="workbench-kicker">需要重试</p><h2>工作台暂时无法更新</h2><p>${escapeHtml(state.message)}</p></div><button type="button" data-action="retry">重试</button></section></section>`;
  }

  const pending = state.status === "ready" ? state.pendingCount : 0;
  const primaryLabel = scanning ? "正在检查..." : "检查变更";
  const scanFacts = state.status === "ready"
    ? `<p class="workbench-summary">${pending} 项待确认变更</p>`
    : `<p class="workbench-summary">没有待确认变更</p>`;
  const publicationState = state.status === "ready"
    ? state.publicationState === "blocked" ? "发布受阻" : "发布目标已就绪"
    : "发布记录可用";
  const openChanges = pending
    ? `<button type="button" class="workbench-secondary" data-action="open-changes">查看变更</button>`
    : "";

  return `<section class="workbench-page" aria-labelledby="workbench-title">${header}<section class="workbench-status"><div><p class="workbench-kicker">${pending ? "下一步" : "状态正常"}</p><h2>${pending ? `处理 ${pending} 项待确认变更` : "检查最近的内容变化"}</h2>${scanFacts}</div><div class="workbench-actions"><button type="button" data-action="scan" ${scanning ? "disabled" : ""}>${primaryLabel}</button>${openChanges}</div></section><dl class="workbench-facts"><div><dt>检测范围</dt><dd>${escapeHtml(state.scopeName)}</dd></div><div><dt>上次检测</dt><dd>${escapeHtml(formatTime(state.scannedAt))}</dd></div><div><dt>发布状态</dt><dd>${publicationState}</dd></div></dl><section class="workbench-activity" aria-label="最近发布"><p class="workbench-kicker">最近发布</p><p>${escapeHtml(publicationSummary(state.latestPublication))}</p></section></section>`;
}

export function mountWorkbench(
  root: HTMLElement,
  api: WorkbenchApi = defaultApi,
  navigation: WorkbenchNavigation,
): { refresh: () => void } {
  let state: WorkbenchState = { status: "loading" };
  let activeScopeId: ScopeId | undefined;
  let scanning = false;
  let scannedAt: string | undefined;

  const render = () => {
    root.innerHTML = renderWorkbench(state, scanning);
  };
  const refresh = async () => {
    state = { status: "loading" };
    render();
    const loaded = await loadWorkbenchContext(api, scannedAt);
    state = loaded.state;
    activeScopeId = loaded.scopeId;
    render();
  };

  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "open-sources") {
      navigation.openSources();
      return;
    }
    if (action === "open-changes") {
      navigation.openChanges(activeScopeId);
      return;
    }
    if (action === "retry") {
      void refresh();
      return;
    }
    if (action !== "scan" || !activeScopeId || scanning) return;

    scanning = true;
    render();
    void api.scanScope(activeScopeId).then((result) => {
      scannedAt = result.scanned_at;
      const prior = state.status === "ready" || state.status === "empty" ? state : undefined;
      if (!prior) return;
      state = result.changes.length
        ? {
            status: "ready",
            scopeName: prior.scopeName,
            pendingCount: result.changes.length,
            scannedAt,
            publicationState: prior.status === "ready" ? prior.publicationState : "ready",
            latestPublication: prior.latestPublication,
          }
        : { status: "empty", scopeName: prior.scopeName, scannedAt, latestPublication: prior.latestPublication };
    }).catch((error) => {
      state = { status: "error", message: errorMessage(error, "检测没有完成") };
    }).finally(() => {
      scanning = false;
      render();
    });
  });

  void refresh();
  return { refresh: () => { void refresh(); } };
}
