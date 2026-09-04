import { listChanges } from "../../bridge/changes";
import { previewRelease, publishRelease } from "../../bridge/releases";
import { listScopes } from "../../bridge/sources";
import { listTargets } from "../../bridge/targets";
import type { Change, ChangeKind, ConnectedTarget, FileChangeKind, Publication, ReleasePlan, ScopeId, ScopeSummary } from "../../contracts";
import type { ChangesApi } from "./index";

export type ReviewState =
  | { status: "loading" }
  | { status: "ready"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; activeView: "summary" | "markdown" | "diff" }
  | { status: "previewing"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string }
  | { status: "preview"; scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; plan: ReleasePlan; target: ConnectedTarget }
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

function activeFrom(state: SelectedReviewState): Change | undefined {
  return state.selectedChanges.find((change) => change.id === state.activeChangeId);
}

function renderSequence(state: SelectedReviewState): string {
  return `<aside class="review-sequence" aria-label="本次评审变更"><header><span>${state.selectedChanges.length} 项</span></header><ol>${state.selectedChanges.map((change) => `<li><button type="button" data-action="select-review-change" data-change-id="${escapeHtml(change.id)}" ${change.id === state.activeChangeId ? 'aria-current="true"' : ""}><strong>${escapeHtml(titleFor(change))}</strong><span>${escapeHtml(changeKindLabels[change.kind])}</span></button></li>`).join("")}</ol></aside>`;
}

function renderTabs(activeView: "summary" | "markdown" | "diff"): string {
  return `<div class="review-tabs" role="tablist" aria-label="评审视图">${(["summary", "markdown", "diff"] as const).map((view) => {
    const label = view === "summary" ? "概览" : view === "markdown" ? "Markdown" : "差异";
    return `<button type="button" role="tab" data-action="change-review-view" data-review-view="${view}" ${view === activeView ? 'aria-selected="true"' : 'aria-selected="false"'}>${label}</button>`;
  }).join("")}</div>`;
}

function renderActiveContent(change: Change | undefined, view: "summary" | "markdown" | "diff", plan?: ReleasePlan): string {
  if (!change) return `<section class="review-content"><p>请选择一项变更。</p></section>`;
  if (view === "markdown") {
    const metadata = [
      `source_path: ${change.source_path}`,
      `source_identity: ${change.source_identity}`,
      change.snapshot ? `observed_at: ${change.snapshot.observed_at}` : "snapshot: 尚无可用快照",
    ].join("\n");
    return `<section class="review-content"><h2>${escapeHtml(titleFor(change))}</h2><pre class="review-markdown">${escapeHtml(metadata)}</pre></section>`;
  }
  if (view === "diff") {
    const matchingDiffs = plan?.diffs.filter((diff) => diff.path === change.source_path) ?? [];
    const displayedDiffs = matchingDiffs.length ? matchingDiffs : plan?.diffs ?? [];
    return `<section class="review-content"><h2>${escapeHtml(titleFor(change))}</h2>${displayedDiffs.length ? `<div class="review-diffs">${displayedDiffs.map((diff) => `<article><header><strong>${escapeHtml(diff.path)}</strong><span>${escapeHtml(fileChangeKindLabels[diff.kind])}</span></header><pre>${escapeHtml(diff.patch)}</pre></article>`).join("")}</div>` : `<p class="review-muted">生成预览后，这里会显示持久化的文件差异。</p>`}</section>`;
  }
  return `<section class="review-content"><p class="eyebrow">${escapeHtml(changeKindLabels[change.kind])}</p><h2>${escapeHtml(titleFor(change))}</h2><dl class="review-facts"><div><dt>来源路径</dt><dd>${escapeHtml(change.source_path)}</dd></div><div><dt>变更类型</dt><dd>${escapeHtml(changeKindLabels[change.kind])}</dd></div>${change.previous_path ? `<div><dt>原路径</dt><dd>${escapeHtml(change.previous_path)}</dd></div>` : ""}</dl><p class="review-note">${escapeHtml(changeNote(change))}</p></section>`;
}

export function renderPublishDialog(plan: ReleasePlan, target: ConnectedTarget): string {
  return `<dialog data-publish-dialog aria-labelledby="publish-title"><form method="dialog" class="publish-dialog"><header><p class="eyebrow">EASYBLOG / PUBLISH</p><h2 id="publish-title">确认发布</h2></header><dl><div><dt>仓库</dt><dd>${escapeHtml(target.repository)}</dd></div><div><dt>分支</dt><dd>${escapeHtml(target.default_branch)}</dd></div><div><dt>已选变更</dt><dd>${plan.batch.change_ids.length} 项</dd></div><div><dt>受影响文件</dt><dd>${plan.diffs.length} 个</dd></div></dl><footer><button type="button" class="secondary-button" data-action="cancel-publish">取消</button><button type="button" class="review-primary-button" data-action="confirm-publish" data-batch-id="${escapeHtml(plan.batch.id)}">确认发布</button></footer></form></dialog>`;
}

export function renderChangeReview(state: ReviewState): string {
  if (state.status === "loading") return `<main class="review-page" aria-busy="true"><p class="review-loading">正在加载评审内容...</p></main>`;
  if (state.status === "error") {
    const action = state.recovery === "retry-preview" ? "retry-preview" : state.recovery === "open-sources" ? "open-sources" : "back-to-changes";
    const label = state.recovery === "retry-preview" ? "重试预览" : state.recovery === "open-sources" ? "前往来源" : "返回变更";
    return `<main class="review-page"><section class="review-recovery" role="alert"><h1>无法继续评审</h1><p>${escapeHtml(state.message)}</p><button type="button" class="review-primary-button" data-action="${action}">${label}</button></section></main>`;
  }
  if (state.status === "published") return `<main class="review-page"><section class="review-published" role="status"><p class="eyebrow">EASYBLOG / PUBLISHED</p><h1>发布已推送</h1><p>提交 <code>${escapeHtml(state.publication.commit_sha)}</code> 已发布。</p><button type="button" data-action="back-to-changes">返回变更</button></section></main>`;
  if (state.status === "publishing") return `<main class="review-page"><section class="review-recovery" role="status"><h1>正在发布</h1><p>正在向 ${escapeHtml(state.target.repository)} 推送已确认的预览。</p></section></main>`;

  const activeChange = activeFrom(state);
  const activeView = state.status === "ready" ? state.activeView : state.status === "preview" ? "diff" : "summary";
  const plan = state.status === "preview" ? state.plan : undefined;
  const summary = state.status === "preview"
    ? `<footer class="review-actions"><span>${state.plan.diffs.length} 个目标文件</span><button type="button" class="review-primary-button" data-action="open-publish-dialog">确认发布</button></footer>${renderPublishDialog(state.plan, state.target)}`
    : `<footer class="review-actions"><span>${state.selectedChanges.length} 项变更待确认</span><button type="button" class="review-primary-button" data-action="preview-release" ${state.status === "previewing" ? "disabled" : ""}>${state.status === "previewing" ? "正在生成预览..." : "预览发布"}</button></footer>`;
  return `<main class="review-page"><header class="review-header"><button type="button" class="secondary-button" data-action="back-to-changes">返回变更</button><div><p class="eyebrow">EASYBLOG / RELEASE REVIEW</p><h1>${escapeHtml(state.scope.scope.name)}</h1></div></header><div class="review-layout">${renderSequence(state)}<section class="review-pane">${renderTabs(activeView)}${renderActiveContent(activeChange, activeView, plan)}${summary}</section></div></main>`;
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
  let activeView: "summary" | "markdown" | "diff" = "summary";
  let generation = 0;
  const render = () => { root.innerHTML = renderChangeReview(state); };
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
    state = { status: "previewing", scope: reviewScope, selectedChanges: reviewChanges, activeChangeId };
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
      state = { status: "preview", scope: reviewScope!, selectedChanges: reviewChanges, activeChangeId, plan, target };
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
    if (action === "select-review-change" && (state.status === "ready" || state.status === "previewing" || state.status === "preview")) {
      const activeChangeId = actionElement?.dataset.changeId;
      if (!activeChangeId || !state.selectedChanges.some((change) => change.id === activeChangeId)) return;
      state = { ...state, activeChangeId };
      render();
      return;
    }
    if (action === "change-review-view" && state.status === "ready") {
      const nextView = actionElement?.dataset.reviewView;
      if (nextView === "summary" || nextView === "markdown" || nextView === "diff") {
        activeView = nextView;
        state = { ...state, activeView };
        render();
      }
      return;
    }
    if (action === "open-publish-dialog" && state.status === "preview") {
      root.querySelector<HTMLDialogElement>("[data-publish-dialog]")?.showModal();
      return;
    }
    if (action === "cancel-publish") {
      actionElement?.closest<HTMLDialogElement>("dialog")?.close();
      return;
    }
    if (action === "confirm-publish" && state.status === "preview" && api.publishRelease) {
      const batchId = actionElement?.dataset.batchId;
      if (batchId !== state.plan.batch.id) return;
      const { plan, target } = state;
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
  void load();
}
