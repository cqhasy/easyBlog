import { listChanges } from "../../bridge/changes";
import { previewRelease, publishRelease } from "../../bridge/releases";
import { listScopes } from "../../bridge/sources";
import { listTargets } from "../../bridge/targets";
import type { Change, ChangeKind, ConnectedTarget, FileChangeKind, Publication, ReleasePlan, ScopeId, ScopeSummary } from "../../contracts";
import type { ChangesApi } from "./index";

export type ReviewState =
  | { status: "loading" }
  | { status: "ready"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; activeView: "summary" | "markdown" | "diff" }
  | { status: "previewing"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; activeView: "summary" | "markdown" | "diff" }
  | { status: "preview"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; activeView: "diff"; returnView: "summary" | "markdown" | "diff"; plan: ReleasePlan; target: ConnectedTarget }
  | { status: "publishing"; plan: ReleasePlan; target: ConnectedTarget }
  | { status: "published"; plan: ReleasePlan; publication: Publication }
  | { status: "error"; message: string; recovery: "retry-preview" | "open-sources" | "back-to-changes" };

export type ReviewContext = {
  scopeId: ScopeId;
  selectedChangeIds: string[];
  activeChangeId: string;
};

export type ReviewNavigation = {
  backToChanges: (context: Pick<ReviewContext, "scopeId" | "selectedChangeIds">) => void;
  openSources: () => void;
};

export type ReviewApi = Pick<ChangesApi, "listScopes" | "listChanges" | "listTargets"> & {
  previewRelease?: (input: { scope_id: ScopeId; change_ids: string[] }) => Promise<ReleasePlan>;
  publishRelease?: (input: { batch_id: string }) => Promise<Publication>;
};

const changeKindLabels: Record<ChangeKind, string> = {
  added: "新增",
  updated: "更新",
  moved: "移动",
  deleted: "删除",
  blocked: "需要处理",
};

const fileChangeKindLabels: Record<FileChangeKind, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  unchanged: "未变化",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function titleFor(change: Change): string {
  return change.title ?? change.source_path.split("/").at(-1) ?? "未命名内容";
}

function changeNote(change: Change): string {
  if (change.kind === "deleted") return "此内容将在发布时从目标仓库删除。";
  if (change.kind === "blocked") return change.blocked_reason ?? "此内容暂不能发布。";
  if (change.kind === "moved") return `原路径：${change.previous_path ?? "未知"}`;
  return "内容将在预览中生成对应文件变更。";
}

type SelectedReviewState = Extract<ReviewState, { selectedChanges: Change[] }>;
type ReviewView = "summary" | "markdown" | "diff";

const reviewViews: ReviewView[] = ["summary", "markdown", "diff"];

function activeFrom(state: SelectedReviewState): Change | undefined {
  return state.selectedChanges.find((change) => change.id === state.activeChangeId);
}

function renderSequence(state: SelectedReviewState): string {
  return `<aside class="review-sequence" aria-label="本次评审变更"><header><span>${state.selectedChanges.length} 项</span></header><ol>${state.selectedChanges.map((change) => `<li><button type="button" data-action="select-review-change" data-change-id="${escapeHtml(change.id)}" ${change.id === state.activeChangeId ? 'aria-current="true"' : ""}><strong>${escapeHtml(titleFor(change))}</strong><span>${escapeHtml(changeKindLabels[change.kind])}</span></button></li>`).join("")}</ol></aside>`;
}

function renderReviewPosition(state: SelectedReviewState): string {
  const activeIndex = Math.max(0, state.selectedChanges.findIndex((change) => change.id === state.activeChangeId));
  return `<span class="review-position">第 ${activeIndex + 1} / ${state.selectedChanges.length} 项</span>`;
}

function renderReviewNavigation(state: SelectedReviewState, disabled = false): string {
  const activeIndex = state.selectedChanges.findIndex((change) => change.id === state.activeChangeId);
  const previousDisabled = disabled || activeIndex <= 0;
  const nextDisabled = disabled || activeIndex >= state.selectedChanges.length - 1;
  return `<div class="review-step-actions"><button type="button" class="secondary-button" data-action="previous-review-change" ${previousDisabled ? "disabled" : ""}>上一个</button><button type="button" class="secondary-button" data-action="next-review-change" ${nextDisabled ? "disabled" : ""}>下一个</button></div>`;
}

function renderTabs(activeView: ReviewView): string {
  return `<div class="review-tabs" role="tablist" aria-label="评审视图">${reviewViews.map((view) => {
    const label = view === "summary" ? "概览" : view === "markdown" ? "Markdown" : "差异";
    const active = view === activeView;
    return `<button type="button" id="review-tab-${view}" role="tab" aria-controls="review-panel-${view}" data-action="change-review-view" data-review-view="${view}" aria-selected="${active}" tabindex="${active ? "0" : "-1"}">${label}</button>`;
  }).join("")}</div>`;
}

function renderActiveContent(change: Change | undefined, view: ReviewView, plan?: ReleasePlan): string {
  const panel = (content: string) => `<section class="review-content" id="review-panel-${view}" role="tabpanel" aria-labelledby="review-tab-${view}" tabindex="0">${content}</section>`;
  if (!change) return panel("<p>请选择一项变更。</p>");
  if (view === "markdown") {
    const metadata = [
      `来源路径：${change.source_path}`,
      `来源标识：${change.source_identity}`,
      change.snapshot ? `检测时间：${change.snapshot.observed_at}` : "快照：尚无可用快照",
    ].join("\n");
    return panel(`<h2>${escapeHtml(titleFor(change))}</h2><pre class="review-markdown">${escapeHtml(metadata)}</pre>`);
  }
  if (view === "diff") {
    const matchingDiffs = plan?.diffs.filter((diff) => diff.path === change.source_path) ?? [];
    const displayedDiffs = matchingDiffs.length ? matchingDiffs : plan?.diffs ?? [];
    return panel(`<h2>${escapeHtml(titleFor(change))}</h2>${displayedDiffs.length ? `<div class="review-diffs">${displayedDiffs.map((diff) => `<article><header><strong>${escapeHtml(diff.path)}</strong><span>${escapeHtml(fileChangeKindLabels[diff.kind])}</span></header><pre>${escapeHtml(diff.patch)}</pre></article>`).join("")}</div>` : `<p class="review-muted">生成预览后，这里会显示持久化的文件差异。</p>`}`);
  }
  return panel(`<p class="eyebrow">${escapeHtml(changeKindLabels[change.kind])}</p><h2>${escapeHtml(titleFor(change))}</h2><dl class="review-facts"><div><dt>来源路径</dt><dd>${escapeHtml(change.source_path)}</dd></div><div><dt>变更类型</dt><dd>${escapeHtml(changeKindLabels[change.kind])}</dd></div>${change.previous_path ? `<div><dt>原路径</dt><dd>${escapeHtml(change.previous_path)}</dd></div>` : ""}</dl><p class="review-note">${escapeHtml(changeNote(change))}</p>`);
}

export function renderPublishDialog(plan: ReleasePlan, target: ConnectedTarget): string {
  return `<dialog data-publish-dialog role="dialog" aria-modal="true" aria-labelledby="publish-title" aria-describedby="publish-description"><form method="dialog" class="publish-dialog"><header><p class="eyebrow">发布确认</p><h2 id="publish-title">确认发布</h2></header><p id="publish-description">确认后将把本次预览中的变更推送到发布目标。</p><dl><div><dt>仓库</dt><dd>${escapeHtml(target.repository)}</dd></div><div><dt>分支</dt><dd>${escapeHtml(target.default_branch)}</dd></div><div><dt>已选变更</dt><dd>${plan.batch.change_ids.length} 项</dd></div><div><dt>受影响文件</dt><dd>${plan.diffs.length} 个</dd></div></dl><footer><button type="button" class="secondary-button" data-action="cancel-publish">取消</button><button type="button" class="review-primary-button" data-action="confirm-publish" data-batch-id="${escapeHtml(plan.batch.id)}">确认发布</button></footer></form></dialog>`;
}

export function renderChangeReview(state: ReviewState): string {
  if (state.status === "loading") return `<section class="review-page" aria-labelledby="review-loading-title" aria-busy="true"><h1 id="review-loading-title" class="visually-hidden">正在加载发布评审</h1><p class="review-loading">正在加载评审内容...</p></section>`;
  if (state.status === "error") {
    const action = state.recovery === "retry-preview" ? "retry-preview" : state.recovery === "open-sources" ? "open-sources" : "back-to-changes";
    const label = state.recovery === "retry-preview" ? "重试预览" : state.recovery === "open-sources" ? "前往来源" : "返回变更";
    return `<section class="review-page" aria-labelledby="review-error-title"><section class="review-recovery" role="alert"><h1 id="review-error-title">无法继续评审</h1><p>${escapeHtml(state.message)}</p><button type="button" class="review-primary-button" data-action="${action}">${label}</button></section></section>`;
  }
  if (state.status === "published") return `<section class="review-page" aria-labelledby="review-published-title"><section class="review-published" role="status"><p class="eyebrow">发布完成</p><h1 id="review-published-title">发布已推送</h1><p>提交 <code>${escapeHtml(state.publication.commit_sha)}</code> 已发布。</p><button type="button" data-action="back-to-changes">返回变更</button></section></section>`;
  if (state.status === "publishing") return `<section class="review-page" aria-labelledby="review-publishing-title"><section class="review-recovery" role="status"><h1 id="review-publishing-title">正在发布</h1><p>正在向 ${escapeHtml(state.target.repository)} 推送已确认的预览。</p></section></section>`;

  const activeChange = activeFrom(state);
  const activeView: ReviewView = state.status === "ready" || state.status === "previewing" || state.status === "preview" ? state.activeView : "summary";
  const titleId = state.status === "ready" ? "review-ready-title" : state.status === "previewing" ? "review-previewing-title" : "review-preview-title";
  const title = state.status === "ready" ? `发布评审：${state.scope.scope.name}` : state.status === "previewing" ? `正在生成发布预览：${state.scope.scope.name}` : `发布预览：${state.scope.scope.name}`;
  const plan = state.status === "preview" ? state.plan : undefined;
  const summary = state.status === "preview"
    ? `<footer class="review-actions"><span>${state.plan.diffs.length} 个目标文件</span><button type="button" class="secondary-button" data-action="return-to-review">返回评审</button><button type="button" class="review-primary-button" data-action="open-publish-dialog">确认发布</button></footer>${renderPublishDialog(state.plan, state.target)}`
    : `<footer class="review-actions"><span>${state.selectedChanges.length} 项变更待确认</span>${renderReviewNavigation(state, state.status === "previewing")}${state.status === "previewing" ? '<p class="review-operation" role="status" aria-live="polite">正在生成发布预览...</p>' : ""}<button type="button" class="review-primary-button" data-action="preview-release" ${state.status === "previewing" ? "disabled" : ""}>${state.status === "previewing" ? "正在生成预览..." : "预览发布"}</button></footer>`;
  return `<section class="review-page" aria-labelledby="${titleId}"><header class="review-header"><button type="button" class="secondary-button" data-action="back-to-changes">返回变更</button><div><p class="eyebrow">发布评审</p><h1 id="${titleId}">${escapeHtml(title)}</h1></div>${renderReviewPosition(state)}</header><div class="review-layout">${renderSequence(state)}<section class="review-pane">${renderTabs(activeView)}${renderActiveContent(activeChange, activeView, plan)}${summary}</section></div></section>`;
}

export function mountChangeReview(
  root: HTMLElement,
  api: ReviewApi = { listScopes, listChanges, listTargets, previewRelease, publishRelease },
  context: ReviewContext,
  navigation: ReviewNavigation,
): void {
  let state: ReviewState = { status: "loading" };
  let reviewScope: ScopeSummary | undefined;
  let reviewChanges: Change[] = [];
  let activeView: ReviewView = "summary";
  let generation = 0;
  let publishDialogSession: { dialog: HTMLDialogElement; opener: HTMLElement; nativeModal: boolean } | undefined;
  const render = () => { root.innerHTML = renderChangeReview(state); };
  const restoreDialogFocus = (session: { dialog: HTMLDialogElement; opener: HTMLElement }) => {
    if (publishDialogSession === session) publishDialogSession = undefined;
    session.opener.focus();
  };
  const openPublishDialog = (dialog: HTMLDialogElement, opener: HTMLElement) => {
    const session = { dialog, opener, nativeModal: false };
    publishDialogSession = session;
    if (typeof dialog.showModal === "function") {
      dialog.addEventListener("close", () => restoreDialogFocus(session), { once: true });
      try {
        dialog.showModal();
        session.nativeModal = true;
        return;
      } catch {
        // A partially implemented dialog API can still use the attribute fallback.
      }
    }
    dialog.setAttribute("open", "");
  };
  const closePublishDialog = (dialog?: HTMLDialogElement) => {
    const session = publishDialogSession;
    if (!session) {
      if (typeof dialog?.close === "function") dialog.close();
      else dialog?.removeAttribute("open");
      return;
    }
    if (session.nativeModal && typeof session.dialog.close === "function") {
      session.dialog.close();
      return;
    }
    session.dialog.removeAttribute("open");
    restoreDialogFocus(session);
  };
  const selectReviewView = (nextView: ReviewView, restoreFocus = false) => {
    if (state.status !== "ready") return;
    activeView = nextView;
    state = { ...state, activeView };
    render();
    if (restoreFocus) root.querySelector<HTMLElement>(`[data-review-view="${nextView}"]`)?.focus();
  };
  const backContext = () => ({
    scopeId: context.scopeId,
    selectedChangeIds: reviewChanges.length ? reviewChanges.map((change) => change.id) : context.selectedChangeIds,
  });
  const load = async () => {
    const currentGeneration = ++generation;
    state = { status: "loading" };
    render();
    try {
      const scopes = (await api.listScopes()).filter((item) => item.scope.lifecycle === "active");
      const scope = scopes.find((item) => item.scope.id === context.scopeId);
      if (!scope) throw new Error("这个同步范围已不可用。");
      const changes = await api.listChanges(scope.scope.id);
      if (currentGeneration !== generation) return;
      const byId = new Map(changes.filter((change) => change.kind !== "blocked").map((change) => [change.id, change]));
      reviewChanges = context.selectedChangeIds.flatMap((id) => {
        const change = byId.get(id);
        return change ? [change] : [];
      });
      reviewScope = scope;
      if (!reviewChanges.length) {
        state = { status: "error", message: "所选变更已不存在或暂时无法发布。请返回变更列表重新选择。", recovery: "back-to-changes" };
        render();
        return;
      }
      const activeChangeId = reviewChanges.some((change) => change.id === context.activeChangeId) ? context.activeChangeId : reviewChanges[0].id;
      state = { status: "ready", scope, selectedChanges: reviewChanges, activeChangeId, activeView };
    } catch (error) {
      if (currentGeneration !== generation) return;
      state = { status: "error", message: errorMessage(error, "评审内容暂时无法读取"), recovery: "back-to-changes" };
    }
    render();
  };
  const startPreview = () => {
    if (!reviewScope || !reviewChanges.length || !api.previewRelease) {
      state = { status: "error", message: "暂时无法生成发布预览。", recovery: "retry-preview" };
      render();
      return;
    }
    const previous = state.status === "ready" || state.status === "previewing" || state.status === "preview" ? state : undefined;
    const activeChangeId = previous?.activeChangeId ?? reviewChanges[0].id;
    const currentGeneration = ++generation;
    const returnView = previous?.status === "preview" ? previous.returnView : previous?.activeView ?? activeView;
    state = { status: "previewing", scope: reviewScope, selectedChanges: reviewChanges, activeChangeId, activeView: returnView };
    render();
    void api.previewRelease({ scope_id: reviewScope.scope.id, change_ids: reviewChanges.map((change) => change.id) }).then(async (plan) => {
      const targets = await (api.listTargets?.() ?? Promise.resolve([]));
      if (currentGeneration !== generation) return;
      const target = targets.find((item) => item.id === plan.batch.target_id);
      if (!target) {
        state = { status: "error", message: "当前范围的发布目标不可用，请在来源页重新连接或绑定。", recovery: "open-sources" };
        render();
        return;
      }
      state = { status: "preview", scope: reviewScope!, selectedChanges: reviewChanges, activeChangeId, activeView: "diff", returnView, plan, target };
      render();
    }).catch((error) => {
      if (currentGeneration !== generation) return;
      state = { status: "error", message: errorMessage(error, "发布预览没有完成"), recovery: "retry-preview" };
      render();
    });
  };

  root.addEventListener("click", (event) => {
    const actionElement = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const action = actionElement?.dataset.action;
    if (action === "back-to-changes") { navigation.backToChanges(backContext()); return; }
    if (action === "open-sources") { navigation.openSources(); return; }
    if (action === "retry-preview" || action === "preview-release") { startPreview(); return; }
    if (action === "return-to-review" && state.status === "preview") {
      state = {
        status: "ready",
        scope: state.scope,
        selectedChanges: state.selectedChanges,
        activeChangeId: state.activeChangeId,
        activeView: state.returnView,
      };
      render();
      return;
    }
    const reviewState = state.status === "ready" || state.status === "previewing" || state.status === "preview" ? state : undefined;
    if (action === "select-review-change" && reviewState) {
      const activeChangeId = actionElement?.dataset.changeId;
      if (!activeChangeId || !reviewState.selectedChanges.some((change) => change.id === activeChangeId)) return;
      state = { ...reviewState, activeChangeId };
      render();
      return;
    }
    const readyState = state.status === "ready" ? state : undefined;
    if ((action === "previous-review-change" || action === "next-review-change") && readyState) {
      const activeIndex = readyState.selectedChanges.findIndex((change) => change.id === readyState.activeChangeId);
      const offset = action === "previous-review-change" ? -1 : 1;
      const nextChange = readyState.selectedChanges[activeIndex + offset];
      if (!nextChange) return;
      state = { ...readyState, activeChangeId: nextChange.id };
      render();
      return;
    }
    if (action === "change-review-view" && state.status === "ready") {
      const nextView = actionElement?.dataset.reviewView;
      if (nextView === "summary" || nextView === "markdown" || nextView === "diff") {
        selectReviewView(nextView);
      }
      return;
    }
    if (action === "open-publish-dialog" && state.status === "preview") {
      const dialog = root.querySelector<HTMLDialogElement>("[data-publish-dialog]");
      if (dialog && actionElement) openPublishDialog(dialog, actionElement);
      return;
    }
    if (action === "cancel-publish") {
      closePublishDialog(actionElement?.closest<HTMLDialogElement>("dialog") ?? undefined);
      return;
    }
    if (action === "confirm-publish" && state.status === "preview" && api.publishRelease) {
      const batchId = actionElement?.dataset.batchId;
      if (batchId !== state.plan.batch.id) return;
      const { plan, target } = state;
      closePublishDialog();
      const currentGeneration = ++generation;
      state = { status: "publishing", plan, target };
      render();
      void api.publishRelease({ batch_id: plan.batch.id }).then((publication) => {
        if (currentGeneration !== generation) return;
        state = { status: "published", plan, publication };
        render();
      }).catch((error) => {
        if (currentGeneration !== generation) return;
        state = { status: "error", message: errorMessage(error, "发布没有完成"), recovery: "retry-preview" };
        render();
      });
    }
  });
  root.addEventListener("keydown", (event) => {
    if (state.status !== "ready") return;
    const tab = (event.target as HTMLElement).closest<HTMLElement>("[role='tab'][data-review-view]");
    const currentView = tab?.dataset.reviewView;
    if (currentView !== "summary" && currentView !== "markdown" && currentView !== "diff") return;
    const currentIndex = reviewViews.indexOf(currentView);
    const nextView = event.key === "ArrowRight"
      ? reviewViews[(currentIndex + 1) % reviewViews.length]
      : event.key === "ArrowLeft"
        ? reviewViews[(currentIndex - 1 + reviewViews.length) % reviewViews.length]
        : event.key === "Home"
          ? reviewViews[0]
          : event.key === "End"
            ? reviewViews.at(-1)
            : undefined;
    if (!nextView) return;
    event.preventDefault();
    selectReviewView(nextView, true);
  });
  void load();
}
