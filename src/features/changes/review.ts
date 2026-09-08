import { listChanges } from "../../bridge/changes";
import { activeReleasePreview, previewRelease, publishRelease } from "../../bridge/releases";
import { listScopes } from "../../bridge/sources";
import { listTargets } from "../../bridge/targets";
import type { Change, ChangeKind, ConnectedTarget, FileChangeKind, Publication, ReleasePlan, ScopeId, ScopeSummary } from "../../contracts";
import type { ChangesApi } from "./index";

type SelectedReviewState = { scope: ScopeSummary; selectedChanges: Change[]; activeChangeId: string; viewedChangeIds?: string[] };

export type ReviewState =
  | { status: "loading" }
  | ({ status: "ready" } & SelectedReviewState)
  | ({ status: "previewing" } & SelectedReviewState)
  | ({ status: "preview"; plan: ReleasePlan; target: ConnectedTarget } & SelectedReviewState)
  | { status: "publishing"; plan: ReleasePlan; target: ConnectedTarget }
  | { status: "published"; plan: ReleasePlan; publication: Publication }
  | { status: "error"; message: string; recovery: "retry-preview" | "open-sources" | "back-to-changes" };

export type ReviewContext = { scopeId: ScopeId; selectedChangeIds: string[]; activeChangeId: string };
export type ReviewNavigation = { backToChanges: (context: Pick<ReviewContext, "scopeId" | "selectedChangeIds">) => void; openSources: () => void };
export type ReviewApi = Pick<ChangesApi, "listScopes" | "listChanges" | "listTargets"> & {
  activeReleasePreview?: (input: { scope_id: ScopeId }) => Promise<ReleasePlan | null>;
  previewRelease?: (input: { scope_id: ScopeId; change_ids: string[] }) => Promise<ReleasePlan>;
  publishRelease?: (input: { batch_id: string }) => Promise<Publication>;
};

const changeKindLabels: Record<ChangeKind, string> = { added: "新增", updated: "更新", moved: "移动", deleted: "删除", blocked: "需要处理" };
const fileChangeKindLabels: Record<FileChangeKind, string> = { added: "新增", modified: "修改", deleted: "删除", unchanged: "未变化" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return fallback;
}

function titleFor(change: Change): string { return change.title ?? change.source_path.split("/").at(-1) ?? "未命名内容"; }
function activeFrom(state: SelectedReviewState): Change | undefined { return state.selectedChanges.find((change) => change.id === state.activeChangeId); }
function viewedIds(state: SelectedReviewState): string[] { return state.viewedChangeIds ?? []; }

function queueStatus(change: Change, state: SelectedReviewState): { label: string; tone: "done" | "current" | "caution" | "pending" } {
  if (change.id === state.activeChangeId) return { label: "当前", tone: "current" };
  if (viewedIds(state).includes(change.id)) return { label: "已查看", tone: "done" };
  if (change.kind === "deleted" || change.kind === "blocked") return { label: "需注意", tone: "caution" };
  return { label: "待查看", tone: "pending" };
}

function renderSequence(state: SelectedReviewState, query = ""): string {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const displayed = state.selectedChanges.filter((change) => !normalizedQuery || `${titleFor(change)} ${change.source_path}`.toLocaleLowerCase().includes(normalizedQuery));
  const viewedCount = state.selectedChanges.filter((change) => viewedIds(state).includes(change.id)).length;
  const rows = displayed.map((change) => {
    const status = queueStatus(change, state);
    return `<li><button type="button" data-action="select-review-change" data-change-id="${escapeHtml(change.id)}" ${change.id === state.activeChangeId ? 'aria-current="true"' : ""}><strong>${escapeHtml(titleFor(change))}</strong><span class="review-queue-meta"><i class="review-queue-dot review-queue-dot-${status.tone}" aria-hidden="true"></i>${escapeHtml(changeKindLabels[change.kind])} · ${status.label}</span></button></li>`;
  }).join("");
  const empty = displayed.length ? "" : '<li class="review-search-empty">没有匹配的变更</li>';
  return `<aside class="review-sequence" aria-label="本次评审变更"><header><div><strong>评审清单</strong><span>${viewedCount} / ${state.selectedChanges.length} 已查看</span></div><label class="review-search"><i data-lucide="search" aria-hidden="true"></i><span class="visually-hidden">搜索评审内容</span><input id="review-search" type="search" name="review-search" data-action="filter-review-changes" value="${escapeHtml(query)}" placeholder="搜索内容…" aria-label="搜索评审清单" autocomplete="off" /></label></header><ol>${rows}${empty}</ol></aside>`;
}

function renderReviewPosition(state: SelectedReviewState): string {
  const index = Math.max(0, state.selectedChanges.findIndex((change) => change.id === state.activeChangeId));
  return `<span class="review-position">第 ${index + 1} / ${state.selectedChanges.length} 项</span>`;
}

function renderIconButton(action: string, icon: string, label: string, disabled = false): string {
  return `<button type="button" class="icon-button review-step-button" data-action="${action}" ${disabled ? "disabled " : ""}aria-label="${label}" title="${label}"><i data-lucide="${icon}" aria-hidden="true"></i></button>`;
}

function renderReviewNavigation(state: SelectedReviewState, disabled = false): string {
  const index = state.selectedChanges.findIndex((change) => change.id === state.activeChangeId);
  const finalItem = index >= state.selectedChanges.length - 1;
  const next = finalItem
    ? `<button type="button" class="review-primary-button" data-action="preview-release" ${disabled ? "disabled" : ""}>${disabled ? "正在生成预览…" : "预览发布"}</button>`
    : renderIconButton("next-review-change", "chevron-right", "查看下一项", disabled);
  return `<div class="review-step-actions">${renderIconButton("previous-review-change", "chevron-left", "查看上一项", disabled || index <= 0)}${next}</div>`;
}

type ParsedDiffLine = { kind: "addition" | "deletion" | "context"; oldLine: string; newLine: string; content: string };
type DiffSegment = { kind: "lines"; lines: ParsedDiffLine[] } | { kind: "collapsed"; lines: ParsedDiffLine[] };

function hunkLineNumbers(line: string): { oldLine: number; newLine: number } | undefined {
  const match = line.match(/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/);
  return match ? { oldLine: Number(match[1]), newLine: Number(match[2]) } : undefined;
}

function parseDiff(patch: string): ParsedDiffLine[] {
  let oldLine = 0;
  let newLine = 0;
  const lines: ParsedDiffLine[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const hunk = hunkLineNumbers(line);
    if (hunk) { oldLine = hunk.oldLine; newLine = hunk.newLine; continue; }
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) { lines.push({ kind: "addition", oldLine: "", newLine: String(newLine++), content: line.slice(1) }); continue; }
    if (line.startsWith("-")) { lines.push({ kind: "deletion", oldLine: String(oldLine++), newLine: "", content: line.slice(1) }); continue; }
    if (line.startsWith(" ")) { lines.push({ kind: "context", oldLine: String(oldLine++), newLine: String(newLine++), content: line.slice(1) }); }
  }
  return lines;
}

function segmentDiff(lines: ParsedDiffLine[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let context: ParsedDiffLine[] = [];
  const flushContext = () => {
    if (!context.length) return;
    if (context.length > 4) {
      segments.push({ kind: "lines", lines: context.slice(0, 2) });
      segments.push({ kind: "collapsed", lines: context.slice(2, -2) });
      segments.push({ kind: "lines", lines: context.slice(-2) });
    } else segments.push({ kind: "lines", lines: context });
    context = [];
  };
  for (const line of lines) {
    if (line.kind === "context") context.push(line);
    else {
      flushContext();
      const last = segments.at(-1);
      if (last?.kind === "lines") last.lines.push(line);
      else segments.push({ kind: "lines", lines: [line] });
    }
  }
  flushContext();
  return segments;
}

function diffStats(lines: ParsedDiffLine[]): string {
  const additions = lines.filter((line) => line.kind === "addition").length;
  const deletions = lines.filter((line) => line.kind === "deletion").length;
  return `修改 · ${additions} additions · ${deletions} deletions`;
}

function renderDiffPatch(patch: string): { html: string; stats: string } {
  const lines = parseDiff(patch);
  const renderRow = (line: ParsedDiffLine) => `<div class="review-diff-row review-diff-row-${line.kind}"><span class="review-diff-number" aria-hidden="true">${line.oldLine}</span><span class="review-diff-number" aria-hidden="true">${line.newLine}</span><span class="review-diff-content"><code class="review-diff-code">${escapeHtml(line.content)}</code></span></div>`;
  const html = segmentDiff(lines).map((segment) => {
    if (segment.kind === "collapsed") {
      const rows = segment.lines.map(renderRow).join("");
      return `<details class="review-diff-context"><summary aria-label="展开 ${segment.lines.length} 行未修改内容"><i data-lucide="chevrons-up-down" aria-hidden="true"></i><span>${segment.lines.length} 行未修改内容</span></summary>${rows}</details>`;
    }
    return segment.lines.map(renderRow).join("");
  }).join("");
  return { html: `<div class="review-diff" role="region" aria-label="文件差异"><div class="review-diff-canvas">${html || '<div class="review-diff-row review-diff-row-context"><span></span><span></span><span class="review-diff-content"><code class="review-diff-code">没有可显示的文本差异。</code></span></div>'}</div></div>`, stats: diffStats(lines) };
}

function displayedDiffs(change: Change, plan?: ReleasePlan) {
  if (!plan) return [];
  const exact = plan.diffs.filter((diff) => diff.path === change.source_path);
  if (exact.length) return exact;
  return plan.diffs.length === 1 ? plan.diffs : plan.diffs.filter((diff) => diff.path.endsWith(`/${change.source_path.split("/").at(-1)}`));
}

function renderReviewContent(change: Change | undefined, plan?: ReleasePlan): string {
  if (!change) return '<section class="review-content"><p class="review-muted">请选择一项变更。</p></section>';
  const diffs = displayedDiffs(change, plan);
  const targetPath = diffs[0]?.path;
  const header = `<header class="review-article-header"><p class="review-kind">${escapeHtml(changeKindLabels[change.kind])}</p><div class="review-file-map"><code>${escapeHtml(change.source_path)}</code><i data-lucide="arrow-right" aria-hidden="true"></i>${targetPath ? `<code>${escapeHtml(targetPath)}</code>` : '<span>目标文件将在预览中生成</span>'}</div></header>`;
  if (!plan) return `<section class="review-content">${header}<div class="review-body"><p class="review-muted">逐项确认后，生成发布预览以查看最终文件差异。</p></div></section>`;
  const articles = diffs.map((diff) => {
    const rendered = renderDiffPatch(diff.patch);
    return `<article class="review-diff-article"><div class="review-diff-toolbar"><h2>文件差异</h2><span>${rendered.stats}</span></div>${rendered.html}</article>`;
  }).join("");
  return `<section class="review-content">${header}<div class="review-body">${articles || '<p class="review-muted">此项没有可显示的目标文件差异。</p>'}</div></section>`;
}

export function renderPublishDialog(plan: ReleasePlan, target: ConnectedTarget): string {
  return `<dialog data-publish-dialog role="dialog" aria-modal="true" aria-labelledby="publish-title" aria-describedby="publish-description"><form method="dialog" class="publish-dialog"><header><p class="eyebrow">发布确认</p><h2 id="publish-title">确认发布</h2></header><p id="publish-description">确认后将把本次预览中的变更推送到发布目标。</p><dl><div><dt>仓库</dt><dd>${escapeHtml(target.repository)}</dd></div><div><dt>分支</dt><dd>${escapeHtml(target.default_branch)}</dd></div><div><dt>已选变更</dt><dd>${plan.batch.change_ids.length} 项</dd></div><div><dt>受影响文件</dt><dd>${plan.diffs.length} 个</dd></div></dl><footer><button type="button" class="secondary-button" data-action="cancel-publish">取消</button><button type="button" class="review-primary-button" data-action="confirm-publish" data-batch-id="${escapeHtml(plan.batch.id)}">确认发布</button></footer></form></dialog>`;
}

export function renderChangeReview(state: ReviewState, query = ""): string {
  if (state.status === "loading") return '<section class="review-page" aria-labelledby="review-loading-title" aria-busy="true"><h1 id="review-loading-title" class="visually-hidden">正在加载发布评审</h1><p class="review-loading">正在加载评审内容…</p></section>';
  if (state.status === "error") { const action = state.recovery === "retry-preview" ? "retry-preview" : state.recovery === "open-sources" ? "open-sources" : "back-to-changes"; const label = state.recovery === "retry-preview" ? "重试预览" : state.recovery === "open-sources" ? "前往来源" : "返回变更"; return `<section class="review-page" aria-labelledby="review-error-title"><section class="review-recovery" role="alert"><h1 id="review-error-title">无法继续评审</h1><p>${escapeHtml(state.message)}</p><button type="button" class="review-primary-button" data-action="${action}">${label}</button></section></section>`; }
  if (state.status === "published") return `<section class="review-page" aria-labelledby="review-published-title"><section class="review-published" role="status"><p class="eyebrow">发布完成</p><h1 id="review-published-title">发布已推送</h1><p>提交 <code>${escapeHtml(state.publication.commit_sha)}</code> 已发布。</p><button type="button" data-action="back-to-changes">返回变更</button></section></section>`;
  if (state.status === "publishing") return `<section class="review-page" aria-labelledby="review-publishing-title"><section class="review-recovery" role="status"><h1 id="review-publishing-title">正在发布</h1><p>正在向 ${escapeHtml(state.target.repository)} 推送已确认的预览。</p></section></section>`;
  const titleId = state.status === "ready" ? "review-ready-title" : state.status === "previewing" ? "review-previewing-title" : "review-preview-title";
  const title = state.status === "preview" ? "发布预览" : "发布评审";
  const remaining = state.selectedChanges.filter((change) => !viewedIds(state).includes(change.id) && change.id !== state.activeChangeId).length;
  const footer = state.status === "preview"
    ? `<footer class="review-actions"><span>${state.plan.diffs.length} 个目标文件</span><button type="button" class="secondary-button" data-action="return-to-review">返回评审</button><button type="button" class="review-primary-button" data-action="open-publish-dialog">确认发布</button></footer>${renderPublishDialog(state.plan, state.target)}`
    : `<footer class="review-actions"><span>${remaining ? `还剩 ${remaining} 项待查看` : "已查看本次全部变更"}</span>${renderReviewNavigation(state, state.status === "previewing")}${state.status === "previewing" ? '<p class="review-operation" role="status" aria-live="polite">正在生成发布预览…</p>' : ""}</footer>`;
  return `<section class="review-page" aria-labelledby="${titleId}"><header class="review-header"><button type="button" class="back-button" data-action="back-to-changes" aria-label="返回变更" title="返回变更"><i data-lucide="arrow-left" aria-hidden="true"></i></button><div><p class="review-crumb">${escapeHtml(state.scope.scope.name)} · 本次选择 ${state.selectedChanges.length} 项</p><h1 id="${titleId}">${title}</h1></div>${renderReviewPosition(state)}</header><div class="review-layout">${renderSequence(state, query)}<section class="review-pane">${renderReviewContent(activeFrom(state), state.status === "preview" ? state.plan : undefined)}</section></div>${footer}</section>`;
}

export function mountChangeReview(root: HTMLElement, api: ReviewApi = { listScopes, listChanges, listTargets, activeReleasePreview, previewRelease, publishRelease }, context: ReviewContext, navigation: ReviewNavigation, onRendered: () => void = () => undefined): void {
  let state: ReviewState = { status: "loading" };
  let reviewScope: ScopeSummary | undefined;
  let reviewChanges: Change[] = [];
  let query = "";
  let generation = 0;
  let publishDialogSession: { dialog: HTMLDialogElement; opener: HTMLElement; nativeModal: boolean } | undefined;
  const render = () => { root.innerHTML = renderChangeReview(state, query); onRendered(); };
  const backContext = () => ({ scopeId: reviewScope?.scope.id ?? context.scopeId, selectedChangeIds: reviewChanges.length ? reviewChanges.map((change) => change.id) : context.selectedChangeIds });
  const load = async () => {
    const current = ++generation; state = { status: "loading" }; render();
    try {
      const scopes = (await api.listScopes()).filter((item) => item.scope.lifecycle === "active");
      const requestedScope = scopes.find((item) => item.scope.id === context.scopeId);
      if (!requestedScope) throw new Error("这个同步范围已不可用。");
      const activePlan = await api.activeReleasePreview?.({ scope_id: requestedScope.scope.id });
      if (current !== generation) return;
      if (activePlan) {
        const activeScope = scopes.find((item) => item.scope.id === activePlan.batch.scope_id);
        if (!activeScope) {
          state = { status: "error", message: "已有的发布预览所属来源已不可用。请返回来源页检查发布目标。", recovery: "open-sources" };
          render();
          return;
        }
        const changes = await api.listChanges(activeScope.scope.id);
        if (current !== generation) return;
        const byId = new Map(changes.filter((change) => change.kind !== "blocked").map((change) => [change.id, change]));
        const activeChanges = activePlan.batch.change_ids.flatMap((id) => {
          const change = byId.get(id);
          return change ? [change] : [];
        });
        const targets = await (api.listTargets?.() ?? Promise.resolve([]));
        if (current !== generation) return;
        const target = targets.find((item) => item.id === activePlan.batch.target_id);
        if (!target || activeChanges.length !== activePlan.batch.change_ids.length) {
          state = { status: "error", message: "已有的发布预览无法恢复。请返回变更列表检查当前内容和发布目标。", recovery: !target ? "open-sources" : "back-to-changes" };
          render();
          return;
        }
        reviewScope = activeScope;
        reviewChanges = activeChanges;
        const activeChangeId = reviewChanges.some((change) => change.id === context.activeChangeId) ? context.activeChangeId : reviewChanges[0].id;
        state = { status: "preview", scope: activeScope, selectedChanges: reviewChanges, activeChangeId, viewedChangeIds: [activeChangeId], plan: activePlan, target };
        render();
        return;
      }
      const changes = await api.listChanges(requestedScope.scope.id);
      if (current !== generation) return;
      const byId = new Map(changes.filter((change) => change.kind !== "blocked").map((change) => [change.id, change]));
      reviewChanges = context.selectedChangeIds.flatMap((id) => { const change = byId.get(id); return change ? [change] : []; });
      if (!reviewChanges.length) { state = { status: "error", message: "所选变更已不存在或暂时无法发布。请返回变更列表重新选择。", recovery: "back-to-changes" }; render(); return; }
      reviewScope = requestedScope;
      const activeChangeId = reviewChanges.some((change) => change.id === context.activeChangeId) ? context.activeChangeId : reviewChanges[0].id;
      state = { status: "ready", scope: requestedScope, selectedChanges: reviewChanges, activeChangeId, viewedChangeIds: [activeChangeId] };
    } catch (error) { if (current !== generation) return; state = { status: "error", message: errorMessage(error, "评审内容暂时无法读取"), recovery: "back-to-changes" }; }
    render();
  };
  const startPreview = () => {
    if (!reviewScope || !reviewChanges.length || !api.previewRelease) { state = { status: "error", message: "暂时无法生成发布预览。", recovery: "retry-preview" }; render(); return; }
    const previous = state.status === "ready" || state.status === "previewing" || state.status === "preview" ? state : undefined;
    const current = ++generation;
    state = { status: "previewing", scope: reviewScope, selectedChanges: reviewChanges, activeChangeId: previous?.activeChangeId ?? reviewChanges[0].id, viewedChangeIds: previous ? viewedIds(previous) : [] }; render();
    void api.previewRelease({ scope_id: reviewScope.scope.id, change_ids: reviewChanges.map((change) => change.id) }).then(async (plan) => {
      const targets = await (api.listTargets?.() ?? Promise.resolve([]));
      if (current !== generation) return;
      const target = targets.find((item) => item.id === plan.batch.target_id);
      state = target ? { status: "preview", scope: reviewScope!, selectedChanges: reviewChanges, activeChangeId: previous?.activeChangeId ?? reviewChanges[0].id, viewedChangeIds: previous ? viewedIds(previous) : [], plan, target } : { status: "error", message: "当前范围的发布目标不可用，请在来源页重新连接或绑定。", recovery: "open-sources" };
      render();
    }).catch((error) => { if (current === generation) { state = { status: "error", message: errorMessage(error, "发布预览没有完成"), recovery: "retry-preview" }; render(); } });
  };
  const closeDialog = () => { const session = publishDialogSession; if (!session) return; if (session.nativeModal && typeof session.dialog.close === "function") session.dialog.close(); else session.dialog.removeAttribute("open"); publishDialogSession = undefined; session.opener.focus(); };
  root.addEventListener("input", (event) => {
    const input = event.target as { dataset?: DOMStringMap; value?: unknown } | null;
    if (input?.dataset?.action === "filter-review-changes" && typeof input.value === "string") {
      query = input.value;
      render();
      const search = (root as Partial<HTMLElement>).querySelector?.<HTMLInputElement>("#review-search");
      search?.focus();
      search?.setSelectionRange(query.length, query.length);
    }
  });
  root.addEventListener("click", (event) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-action]"); const action = element?.dataset.action;
    if (action === "back-to-changes") { navigation.backToChanges(backContext()); return; }
    if (action === "open-sources") { navigation.openSources(); return; }
    if (action === "retry-preview" || action === "preview-release") { startPreview(); return; }
    const selected = state.status === "ready" || state.status === "previewing" || state.status === "preview" ? state : undefined;
    if (action === "select-review-change" && selected && element?.dataset.changeId && selected.selectedChanges.some((change) => change.id === element.dataset.changeId)) { const activeChangeId = element.dataset.changeId; state = { ...selected, activeChangeId, viewedChangeIds: [...new Set([...viewedIds(selected), activeChangeId])] }; render(); return; }
    if ((action === "previous-review-change" || action === "next-review-change") && selected && state.status !== "previewing") { const index = selected.selectedChanges.findIndex((change) => change.id === selected.activeChangeId); const next = selected.selectedChanges[index + (action === "previous-review-change" ? -1 : 1)]; if (next) { state = { ...selected, activeChangeId: next.id, viewedChangeIds: [...new Set([...viewedIds(selected), next.id])] }; render(); } return; }
    if (action === "return-to-review" && state.status === "preview") { state = { status: "ready", scope: state.scope, selectedChanges: state.selectedChanges, activeChangeId: state.activeChangeId, viewedChangeIds: state.viewedChangeIds }; render(); return; }
    if (action === "open-publish-dialog" && state.status === "preview" && element) { const dialog = root.querySelector<HTMLDialogElement>("[data-publish-dialog]"); if (!dialog) return; publishDialogSession = { dialog, opener: element, nativeModal: false }; if (typeof dialog.showModal === "function") { try { dialog.showModal(); publishDialogSession.nativeModal = true; } catch { dialog.setAttribute("open", ""); } } else dialog.setAttribute("open", ""); return; }
    if (action === "cancel-publish") { closeDialog(); return; }
    if (action === "confirm-publish" && state.status === "preview" && api.publishRelease && element?.dataset.batchId === state.plan.batch.id) { const { plan, target } = state; closeDialog(); const current = ++generation; state = { status: "publishing", plan, target }; render(); void api.publishRelease({ batch_id: plan.batch.id }).then((publication) => { if (current === generation) { state = { status: "published", plan, publication }; render(); } }).catch((error) => { if (current === generation) { state = { status: "error", message: errorMessage(error, "发布没有完成"), recovery: "retry-preview" }; render(); } }); }
  });
  void load();
}
