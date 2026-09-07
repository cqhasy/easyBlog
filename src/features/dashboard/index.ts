import type { Change, ScopeId, ScopeSummary } from "../../contracts";

export type DashboardRowState = "needs_review" | "no_changes" | "unknown";

export type DashboardRow = {
  scope: ScopeSummary;
  state: DashboardRowState;
  changeCount: number | null;
  checkedAt?: string;
};

export type DashboardState =
  | { status: "loading" }
  | { status: "needs_scope" }
  | { status: "ready"; rows: DashboardRow[] }
  | { status: "error"; message: string };

export type DashboardApi = {
  listScopes: () => Promise<ScopeSummary[]>;
  listChanges: (scopeId: ScopeId) => Promise<Change[]>;
  scanScope: (scopeId: ScopeId) => Promise<{ changes: Change[]; scanned_at: string }>;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function sortDashboardRows(rows: DashboardRow[]): DashboardRow[] {
  const order: Record<DashboardRowState, number> = {
    needs_review: 0,
    unknown: 1,
    no_changes: 2,
  };
  return [...rows].sort((left, right) => order[left.state] - order[right.state]
    || left.scope.scope.name.localeCompare(right.scope.scope.name, "zh-CN"));
}

export async function loadDashboard(
  api: DashboardApi,
  checkedAtByScope = new Map<ScopeId, string>(),
): Promise<DashboardState> {
  try {
    const scopes = (await api.listScopes()).filter((summary) => summary.scope.lifecycle === "active");
    if (!scopes.length) return { status: "needs_scope" };
    const rows = await Promise.all(scopes.map(async (scope): Promise<DashboardRow> => {
      try {
        const changes = await api.listChanges(scope.scope.id);
        return {
          scope,
          state: changes.length ? "needs_review" : "no_changes",
          changeCount: changes.length,
          checkedAt: checkedAtByScope.get(scope.scope.id),
        };
      } catch {
        return {
          scope,
          state: "unknown",
          changeCount: null,
          checkedAt: checkedAtByScope.get(scope.scope.id),
        };
      }
    }));
    return { status: "ready", rows: sortDashboardRows(rows) };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "来源状态暂时无法读取") };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function sourceType(scope: ScopeSummary): string {
  const kind = scope.scope.selections[0]?.node.kind;
  if (kind === "feishu_document") return "飞书文档";
  if (kind === "feishu_wiki_node") return "飞书知识库";
  return "本地文件夹";
}

function statusLabel(state: DashboardRowState): string {
  if (state === "needs_review") return "需要评审";
  if (state === "no_changes") return "无变更";
  return "状态未知";
}

function statusIcon(state: DashboardRowState): string {
  if (state === "needs_review") return "circle-dot";
  if (state === "no_changes") return "circle-check";
  return "circle-x";
}

function formatCheckedAt(value?: string): string {
  if (!value) return "本会话尚未检查";
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

function renderSourceRow(row: DashboardRow): string {
  const name = escapeHtml(row.scope.scope.name);
  const stateLabel = statusLabel(row.state);
  const routeLabel = row.state === "unknown"
    ? `打开 ${name} 的来源配置`
    : `打开 ${name} 的变更`;
  const changeSummary = row.state === "needs_review"
    ? `${row.changeCount ?? 0} 项变更`
    : "";
  const checkSummary = formatCheckedAt(row.checkedAt);

  return `<li class="dashboard-source-row" data-dashboard-status="${row.state}"><span class="dashboard-source-icon" role="img" aria-label="${stateLabel}" title="${stateLabel}"><i data-lucide="${statusIcon(row.state)}" aria-hidden="true"></i></span><div class="dashboard-source-main"><strong>${name}</strong><span>${escapeHtml(sourceType(row.scope))} · ${escapeHtml(checkSummary)}</span></div><span class="dashboard-source-change-count">${escapeHtml(changeSummary)}</span><button type="button" class="icon-button dashboard-source-route" data-action="open-source" data-scope-id="${escapeHtml(row.scope.scope.id)}" aria-label="${routeLabel}" title="${routeLabel}"><i data-lucide="arrow-right"></i></button></li>`;
}

function renderSummaryRing(rows: DashboardRow[], pendingChanges: number, latestCheck?: string): string {
  const reviewCount = rows.filter((row) => row.state === "needs_review").length;
  const clearCount = rows.filter((row) => row.state === "no_changes").length;
  const total = rows.length || 1;
  const reviewEnd = Math.round((reviewCount / total) * 360);
  const clearEnd = reviewEnd + Math.round((clearCount / total) * 360);
  const checkedCount = reviewCount + clearCount;
  const label = `${pendingChanges} 项待评审变更，${checkedCount} / ${rows.length} 个来源已检查，最近成功检查：${formatCheckedAt(latestCheck)}`;

  return `<div class="dashboard-summary-ring" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="--dashboard-review-end:${reviewEnd}deg; --dashboard-clear-end:${clearEnd}deg"><span class="dashboard-summary-value">${pendingChanges}</span><span class="dashboard-summary-label">待评审</span></div>`;
}

function renderReadyDashboard(rows: DashboardRow[], scanning: boolean): string {
  const reviewRows = rows.filter((row) => row.state === "needs_review");
  const checkedRows = rows.filter((row) => row.state !== "unknown");
  const pendingChanges = reviewRows.reduce((total, row) => total + (row.changeCount ?? 0), 0);
  const latestCheck = checkedRows
    .map((row) => row.checkedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const signal = reviewRows.length
    ? `${reviewRows.length} 个来源有变更需要评审`
    : rows.some((row) => row.state === "unknown")
      ? "部分来源的状态需要重新检查"
      : "所有来源暂无待评审变更";
  const operation = scanning
    ? '<p class="dashboard-operation" role="status" aria-live="polite">正在检查所有来源...</p>'
    : "";

  return `<header class="dashboard-header"><div><h1 id="dashboard-title">Dashboard</h1><p>集中查看来源状态与待评审内容。</p></div><button type="button" data-action="check-all" ${scanning ? "disabled" : ""}>${scanning ? "正在检查..." : "检查全部"}</button></header><section class="dashboard-overview" aria-labelledby="dashboard-signal-title"><div class="dashboard-signal"><p class="dashboard-kicker">当前状态</p><h2 id="dashboard-signal-title">${signal}</h2>${operation}</div>${renderSummaryRing(rows, pendingChanges, latestCheck)}</section><section class="dashboard-sources" aria-labelledby="dashboard-sources-title"><header><div><h2 id="dashboard-sources-title">来源</h2><p>按待处理优先级排列</p></div><span>${rows.length} 个已启用</span></header><ul>${rows.map(renderSourceRow).join("")}</ul></section>`;
}

export function renderDashboard(
  state: DashboardState = { status: "loading" },
  scanning = false,
): string {
  if (state.status === "loading") {
    return '<section class="dashboard-page" aria-labelledby="dashboard-title"><header class="dashboard-header"><h1 id="dashboard-title">Dashboard</h1></header><p class="dashboard-loading" role="status">正在读取来源状态...</p></section>';
  }
  if (state.status === "needs_scope") {
    return '<section class="dashboard-page" aria-labelledby="dashboard-title"><header class="dashboard-header"><h1 id="dashboard-title">Dashboard</h1></header><section class="dashboard-empty"><h2>先添加一个内容来源</h2><p>添加来源后，Dashboard 会汇总需要评审的变更。</p><button type="button" data-action="open-sources">前往来源</button></section></section>';
  }
  if (state.status === "error") {
    return `<section class="dashboard-page" aria-labelledby="dashboard-title"><header class="dashboard-header"><h1 id="dashboard-title">Dashboard</h1></header><section class="dashboard-message" role="alert"><strong>暂时无法读取来源状态</strong><p>${escapeHtml(state.message)}</p><button type="button" data-action="retry">重试</button></section></section>`;
  }

  return `<section class="dashboard-page" aria-labelledby="dashboard-title">${renderReadyDashboard(state.rows, scanning)}</section>`;
}

export type DashboardNavigation = {
  openChanges: (scopeId?: ScopeId) => void;
  openSources: () => void;
};

export type DashboardController = {
  refresh: () => void;
};

export function mountDashboard(
  root: HTMLElement,
  api: DashboardApi,
  navigation: DashboardNavigation,
  onRendered: () => void = () => undefined,
  checkedAtByScope = new Map<ScopeId, string>(),
): DashboardController {
  let state: DashboardState = { status: "loading" };
  let scanning = false;
  let generation = 0;
  const render = () => {
    root.innerHTML = renderDashboard(state, scanning);
    onRendered();
  };
  const refresh = async () => {
    const requestGeneration = ++generation;
    if (state.status !== "ready") {
      state = { status: "loading" };
      render();
    }
    const nextState = await loadDashboard(api, checkedAtByScope);
    if (requestGeneration !== generation) return;
    state = nextState;
    render();
  };
  const checkAll = async () => {
    if (scanning || state.status !== "ready") return;
    const scanGeneration = ++generation;
    const previousRows = state.rows;
    scanning = true;
    render();
    const nextRows = await Promise.all(previousRows.map(async (row): Promise<DashboardRow> => {
      try {
        const result = await api.scanScope(row.scope.scope.id);
        checkedAtByScope.set(row.scope.scope.id, result.scanned_at);
        return {
          scope: row.scope,
          state: result.changes.length ? "needs_review" : "no_changes",
          changeCount: result.changes.length,
          checkedAt: result.scanned_at,
        };
      } catch {
        return {
          scope: row.scope,
          state: "unknown",
          changeCount: null,
          checkedAt: row.checkedAt,
        };
      }
    }));
    if (scanGeneration !== generation) return;
    state = { status: "ready", rows: sortDashboardRows(nextRows) };
    scanning = false;
    render();
  };

  root.addEventListener("click", (event) => {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = actionElement?.dataset.action;
    if (action === "retry") {
      void refresh();
      return;
    }
    if (action === "open-sources") {
      navigation.openSources();
      return;
    }
    if (action === "check-all") {
      void checkAll();
      return;
    }
    if (action !== "open-source" || state.status !== "ready") return;

    const scopeId = actionElement?.dataset.scopeId;
    const row = state.rows.find((item) => item.scope.scope.id === scopeId);
    if (!row) return;
    if (row.state === "unknown") navigation.openSources();
    else navigation.openChanges(row.scope.scope.id);
  });

  void refresh();
  return { refresh: () => { void refresh(); } };
};
