import { listPublications, retryRelease, rollbackPublication } from "../../bridge/releases";
import type { PublicationOperation, PublicationRecord } from "../../contracts";

export const historyFeature = "history";
type HistoryApi = { listPublications: () => Promise<PublicationRecord[]>; retryRelease: (input: { batch_id: string }) => Promise<void>; rollbackPublication: (input: { batch_id: string }) => Promise<string> };
type HistoryAction = { action: "retry" | "rollback"; label: string };
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const stateLabel = (state: PublicationRecord["state"]) => ({ pending_push: "等待推送", rollback_pending: "等待推送回滚", rolled_back: "已回滚", recovery_required: "需要恢复", legacy: "旧版记录", published: "已发布" })[state];
const changeLabel: Record<PublicationOperation["change_kind"], string> = { added: "新增", updated: "更新", deleted: "删除" };

function formatTime(value: string | null): string {
  if (!value) return "提交已创建，尚未推送";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
function summary(record: PublicationRecord): string {
  const count = record.operations?.length ?? record.change_ids.length;
  if (record.state === "pending_push") return `${count} 项内容等待推送`;
  if (record.state === "rollback_pending") return `${count} 项内容等待回滚推送`;
  if (record.state === "rolled_back") return `已回滚 ${count} 项内容`;
  if (record.state === "recovery_required") return "发布状态需要恢复";
  if (record.state === "legacy") return "旧版发布记录";
  return `${count} 项内容已发布`;
}
export function historyActionFor(record: PublicationRecord): HistoryAction | undefined {
  if (record.state === "pending_push") return { action: "retry", label: "重试推送" };
  if (record.state === "rollback_pending") return { action: "retry", label: "重试回滚推送" };
  if (record.state === "published" && record.rollback_available !== false) return { action: "rollback", label: "回滚" };
}
function reason(record: PublicationRecord): string {
  if (record.state === "legacy") return "单项文件变更不可用，且无法自动回滚。";
  if (record.recovery_reason) return record.recovery_reason;
  if (record.state === "recovery_required") return "此记录需要恢复处理后才能继续。";
  if (record.state === "published" && record.rollback_available === false) return "此发布记录没有可安全执行的回滚操作清单。";
  return "";
}
function rollbackFailureMessage(error: unknown): string {
  const detail = typeof error === "object" && error !== null ? error as { code?: unknown; message?: unknown } : {};
  if (detail.code === "publication_not_reversible" && detail.message === "Another target operation is already active") {
    return "回滚未启动：此发布目标正在执行另一项操作。原发布记录仍为已发布；请等待该操作完成后，从本条记录的操作菜单再次回滚。";
  }
  return "回滚未完成。请查看此记录的当前状态后重试。";
}
function renderAction(record: PublicationRecord): string {
  const action = historyActionFor(record);
  if (!action) return "";
  if (action.action === "retry") return `<button type="button" class="history-text-action" data-action="retry" data-batch-id="${escapeHtml(record.batch_id)}">${action.label}</button>`;
  return `<details class="history-overflow"><summary data-action="open-history-menu" data-batch-id="${escapeHtml(record.batch_id)}" aria-label="打开发布操作菜单" title="发布操作"><i data-lucide="ellipsis-vertical" aria-hidden="true"></i></summary><div class="history-action-menu" role="menu"><button type="button" data-action="open-rollback-dialog" data-batch-id="${escapeHtml(record.batch_id)}">回滚</button></div></details>`;
}
function renderOperation(operation: PublicationOperation): string {
  return `<li class="history-operation"><span class="history-change-kind kind-${operation.change_kind}">${changeLabel[operation.change_kind]}</span><div><div class="history-operation-title"><strong>${escapeHtml(operation.display_name)}</strong><span class="history-object-kind">${operation.object_kind === "resource" ? "资源" : "文章"}</span></div><code>${escapeHtml(operation.target_path)}</code></div></li>`;
}
function renderAudit(record: PublicationRecord): string {
  const rollback = record.rollback_commit_sha ? `<div><dt>回滚提交</dt><dd><code>${escapeHtml(record.rollback_commit_sha)}</code></dd></div>` : "";
  return `<details class="history-audit"><summary>查看发布凭据</summary><dl><div><dt>提交</dt><dd><code>${escapeHtml(record.commit_sha)}</code></dd></div><div><dt>批次</dt><dd><code>${escapeHtml(record.batch_id)}</code></dd></div>${rollback}</dl></details>`;
}
function renderEvent(record: PublicationRecord, expanded: Set<string>): string {
  const operations = record.operations ?? []; const isExpanded = expanded.has(record.batch_id); const shown = isExpanded ? operations : operations.slice(0, 3);
  const expand = operations.length > 3 ? `<button type="button" class="history-expand" data-action="toggle-history-event" data-batch-id="${escapeHtml(record.batch_id)}" aria-expanded="${isExpanded}" aria-label="${isExpanded ? "收起" : "展开"} ${operations.length} 项发布内容">${isExpanded ? "收起内容" : `展开全部 ${operations.length} 项`}</button>` : "";
  const unavailable = reason(record);
  return `<li class="history-event"><time class="history-date">${escapeHtml(formatTime(record.published_at))}</time><span class="history-rail" aria-hidden="true"></span><article class="history-event-content"><header><div><span class="publication-state state-${record.state}">${stateLabel(record.state)}</span><h2>${escapeHtml(summary(record))}</h2><p>${escapeHtml(record.target_id)} <span aria-hidden="true">·</span> ${escapeHtml(record.scope_id)}</p></div>${renderAction(record)}</header>${unavailable ? `<p class="history-unavailable">${escapeHtml(unavailable)}</p>` : ""}${operations.length ? `<ul class="history-operations">${shown.map(renderOperation).join("")}</ul>${expand}` : ""}${isExpanded ? renderAudit(record) : ""}</article></li>`;
}
export function renderRollbackDialog(record: PublicationRecord): string {
  if (historyActionFor(record)?.action !== "rollback") return "";
  const batchId = escapeHtml(record.batch_id);
  const count = record.operations?.length ?? record.change_ids.length;
  const identifier = (value: string) => {
    const visible = value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
    return `<code title="${escapeHtml(value)}" translate="no">${escapeHtml(visible)}</code>`;
  };

  return `<dialog data-rollback-dialog data-batch-id="${batchId}" role="dialog" aria-modal="true" aria-labelledby="rollback-title-${batchId}" aria-describedby="rollback-description-${batchId}"><form method="dialog" class="history-dialog"><header><p class="eyebrow">发布回滚</p><h2 id="rollback-title-${batchId}">确认回滚发布</h2></header><p class="history-dialog-description" id="rollback-description-${batchId}">将创建并推送一条反向提交，不会改写远程历史。</p><dl class="history-dialog-details"><div><dt>发布目标</dt><dd>${identifier(record.target_id)}</dd></div><div><dt>发布批次</dt><dd>${identifier(record.batch_id)}</dd></div><div><dt>原始提交</dt><dd>${identifier(record.commit_sha)}</dd></div><div><dt>受影响内容</dt><dd>${count} 项内容</dd></div></dl><footer class="history-dialog-actions"><button type="button" class="secondary-button" data-action="cancel-rollback">取消</button><button type="button" class="history-primary-button" data-action="confirm-rollback" data-batch-id="${batchId}">确认回滚</button></footer></form></dialog>`;
}
export function renderHistory(records: PublicationRecord[], message = "", expanded = new Set<string>()): string {
  const timeline = records.length ? records.map((record) => renderEvent(record, expanded)).join("") : `<li class="history-empty">尚无发布记录</li>`;
  const objectCount = records.reduce((total, record) => total + (record.operations?.length ?? 0), 0);
  return `<section class="history-page" aria-labelledby="history-title"><header class="history-header"><div><p class="eyebrow">发布记录</p><h1 id="history-title">发布历史</h1><p>按发布时间回看内容对象及其变更状态。</p></div><button type="button" class="icon-button" data-action="refresh-history" aria-label="刷新发布历史" title="刷新发布历史"><i data-lucide="refresh-cw" aria-hidden="true"></i></button></header><p class="history-overview">${records.length} 次发布 <span aria-hidden="true">·</span> ${objectCount} 项内容</p>${message ? `<p class="history-message" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ""}<ol class="history-timeline" aria-label="发布记录时间线">${timeline}</ol>${records.map(renderRollbackDialog).join("")}</section>`;
}
export function mountHistory(root: HTMLElement, api: HistoryApi = { listPublications, retryRelease, rollbackPublication }, hydrate: () => void = () => undefined): void {
  let records: PublicationRecord[] = []; let message = ""; let pending = false; const expanded = new Set<string>(); let session: { dialog: HTMLDialogElement; opener: HTMLElement; nativeModal: boolean } | undefined;
  const render = () => { root.innerHTML = renderHistory(records, message, expanded); hydrate(); };
  const restore = (current: { dialog: HTMLDialogElement; opener: HTMLElement }) => { if (session === current) session = undefined; current.opener.focus(); };
  const close = (dialog?: HTMLDialogElement) => { if (!session) { if (typeof dialog?.close === "function") dialog.close(); else dialog?.removeAttribute("open"); return; } if (session.nativeModal && typeof session.dialog.close === "function") { session.dialog.close(); return; } const current = session; current.dialog.removeAttribute("open"); restore(current); };
  const open = (dialog: HTMLDialogElement, opener: HTMLElement) => { const current = { dialog, opener, nativeModal: false }; session = current; if (typeof dialog.showModal === "function") { dialog.addEventListener("close", () => restore(current), { once: true }); try { dialog.showModal(); current.nativeModal = true; return; } catch { /* fallback */ } } dialog.setAttribute("open", ""); };
  const refresh = (operation = false, next = "") => { void api.listPublications().then((value) => { records = value; if (next) message = next; if (operation) pending = false; render(); }).catch(() => { if (operation) pending = false; message = "发布历史暂时无法加载。"; render(); }); };
  const start = (record: PublicationRecord, action: HistoryAction["action"]) => { if (pending) return; pending = true; message = action === "retry" ? (record.state === "rollback_pending" ? "正在重试回滚推送…" : "正在重试推送…") : "正在创建回滚提交…"; render(); const request = action === "retry" ? api.retryRelease({ batch_id: record.batch_id }) : api.rollbackPublication({ batch_id: record.batch_id }); void request.then(() => { message = action === "retry" ? "发布已推送。" : "回滚提交已推送。"; refresh(true); }).catch((error: unknown) => { if (action === "rollback") { refresh(true, rollbackFailureMessage(error)); return; } pending = false; message = "重试推送未完成。"; render(); }); };
  root.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]"); if (!button) return; const action = button.dataset.action; if (action === "refresh-history") { refresh(); return; } if (action === "cancel-rollback") { close(button.closest<HTMLDialogElement>("dialog") ?? undefined); return; } const record = records.find((item) => item.batch_id === button.dataset.batchId); if (!record) return; if (action === "toggle-history-event") { if (expanded.has(record.batch_id)) expanded.delete(record.batch_id); else expanded.add(record.batch_id); render(); return; } const historyAction = historyActionFor(record); if (action === "retry" && historyAction?.action === "retry") { start(record, "retry"); return; } if (action === "open-rollback-dialog" && historyAction?.action === "rollback") { const dialog = Array.from(root.querySelectorAll<HTMLDialogElement>("[data-rollback-dialog]")).find((item) => item.dataset.batchId === record.batch_id); if (dialog) open(dialog, button); return; } if (action === "confirm-rollback" && historyAction?.action === "rollback") { close(); start(record, "rollback"); } });
  void api.listPublications().then((value) => { records = value; render(); }).catch(() => { message = "发布历史暂时无法加载。"; render(); });
}
