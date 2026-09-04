import { listPublications, retryRelease, rollbackPublication } from "../../bridge/releases";
import type { PublicationRecord } from "../../contracts";

export const historyFeature = "history";

type HistoryApi = { listPublications: () => Promise<PublicationRecord[]>; retryRelease: (input: { batch_id: string }) => Promise<void>; rollbackPublication: (input: { batch_id: string }) => Promise<string> };
type HistoryAction = { action: "retry" | "rollback"; label: string };

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (state: PublicationRecord["state"]) => state === "pending_push" ? "等待推送" : state === "rollback_pending" ? "等待推送回滚" : state === "rolled_back" ? "已回滚" : state === "recovery_required" ? "需要恢复" : state === "legacy" ? "旧版记录" : "已发布";

export function historyActionFor(record: PublicationRecord): HistoryAction | undefined {
  if (record.state === "pending_push") return { action: "retry", label: "重试推送" };
  if (record.state === "rollback_pending") return { action: "retry", label: "重试回滚推送" };
  if (record.state === "published" && record.rollback_available !== false) return { action: "rollback", label: "回滚" };
  return undefined;
}

function unavailableReasonFor(record: PublicationRecord): string {
  if (record.state === "legacy") return "旧版发布记录没有可安全执行的文件操作清单。";
  if (record.recovery_reason) return record.recovery_reason;
  if (record.state === "recovery_required") return "此记录需要恢复处理后才能继续。";
  if (record.state === "published" && record.rollback_available === false) return "此发布记录没有可安全执行的回滚操作清单。";
  return "";
}

function renderHistoryAction(record: PublicationRecord): string {
  const historyAction = historyActionFor(record);
  if (!historyAction) return "";
  const action = historyAction.action === "rollback" ? "open-rollback-dialog" : "retry";
  return `<details class="history-overflow"><summary data-action="open-history-menu" data-batch-id="${escapeHtml(record.batch_id)}" aria-label="打开发布操作菜单" title="发布操作">&#8942;</summary><div class="history-action-menu" role="menu"><button type="button" data-action="${action}" data-batch-id="${escapeHtml(record.batch_id)}">${historyAction.label}</button></div></details>`;
}

export function renderRollbackDialog(record: PublicationRecord): string {
  if (historyActionFor(record)?.action !== "rollback") return "";
  return `<dialog data-rollback-dialog data-batch-id="${escapeHtml(record.batch_id)}" aria-labelledby="rollback-title-${escapeHtml(record.batch_id)}"><form method="dialog" class="history-dialog"><header><p class="eyebrow">EASYBLOG / ROLLBACK</p><h2 id="rollback-title-${escapeHtml(record.batch_id)}">确认回滚发布</h2></header><p>将为提交 <code>${escapeHtml(record.commit_sha)}</code> 创建并推送新的反向提交，不会改写远程历史。</p><dl><div><dt>发布目标</dt><dd>${escapeHtml(record.target_id)}</dd></div><div><dt>发布批次</dt><dd>${escapeHtml(record.batch_id)}</dd></div><div><dt>原始提交</dt><dd>${escapeHtml(record.commit_sha)}</dd></div></dl><footer><button type="button" class="secondary-button" data-action="cancel-rollback">取消</button><button type="button" class="history-primary-button" data-action="confirm-rollback" data-batch-id="${escapeHtml(record.batch_id)}">确认回滚</button></footer></form></dialog>`;
}

export function renderHistory(records: PublicationRecord[], message = ""): string {
  const rows = records.length ? records.map((record) => {
    const reason = unavailableReasonFor(record);
    return `<li class="history-row"><div class="history-commit"><strong>${escapeHtml(record.commit_sha)}</strong><span>批次 ${escapeHtml(record.batch_id)}</span></div><div class="history-context"><strong>${escapeHtml(record.target_id)}</strong><span>${escapeHtml(record.scope_id)} · ${record.change_ids.length} 项变更</span>${reason ? `<span class="history-unavailable">${escapeHtml(reason)}</span>` : ""}</div><div class="history-state"><span class="publication-state state-${record.state}">${label(record.state)}</span></div><time>${escapeHtml(record.published_at ?? "提交已创建，尚未推送")}</time>${renderHistoryAction(record)}</li>`;
  }).join("") : `<li class="history-empty">尚无发布记录</li>`;
  const dialogs = records.map(renderRollbackDialog).join("");
  return `<main class="history-page"><header class="changes-header"><div><p class="eyebrow">EASYBLOG / HISTORY</p><h1>发布历史</h1><p>已发布提交可生成新的反向提交，不会改写远程历史。</p></div><button type="button" class="task-primary-button" data-action="refresh-history">刷新</button></header>${message ? `<p class="history-message" role="status">${escapeHtml(message)}</p>` : ""}<div class="history-column-headings" aria-hidden="true"><span>提交</span><span>目标 / 范围</span><span>状态</span><span>时间</span><span></span></div><ul class="history-list">${rows}</ul>${dialogs}</main>`;
}

export function mountHistory(root: HTMLElement, api: HistoryApi = { listPublications, retryRelease, rollbackPublication }): void {
  let records: PublicationRecord[] = []; let message = ""; let operationPending = false;
  const render = () => { root.innerHTML = renderHistory(records, message); };
  const refresh = (releaseOperation = false, nextMessage = "") => {
    void api.listPublications().then((value) => {
      records = value;
      if (nextMessage) message = nextMessage;
      if (releaseOperation) operationPending = false;
      render();
    }).catch(() => {
      if (releaseOperation) operationPending = false;
      message = "发布历史暂时无法加载。";
      render();
    });
  };
  const startOperation = (record: PublicationRecord, action: HistoryAction["action"]) => {
    if (operationPending) return;
    operationPending = true;
    message = action === "retry" ? (record.state === "rollback_pending" ? "正在重试回滚推送..." : "正在重试推送...") : "正在创建回滚提交...";
    render();
    const operation = action === "retry" ? api.retryRelease({ batch_id: record.batch_id }) : api.rollbackPublication({ batch_id: record.batch_id });
    void operation.then(() => {
      message = action === "retry" ? "发布已推送。" : "回滚提交已推送。";
      refresh(true);
    }).catch(() => {
      if (action === "rollback") {
        refresh(true, `提交 ${record.commit_sha} 的回滚未完成，回滚提交会保留以便重试。`);
        return;
      }
      operationPending = false;
      message = "重试推送未完成。";
      render();
    });
  };
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]"); if (!button) return;
    const action = button.dataset.action; if (action === "refresh-history") { refresh(); return; }
    if (action === "cancel-rollback") {
      button.closest<HTMLDialogElement>("dialog")?.close();
      return;
    }
    const record = records.find((item) => item.batch_id === button.dataset.batchId); if (!record) return;
    const historyAction = historyActionFor(record);
    if (action === "retry" && historyAction?.action === "retry") { startOperation(record, "retry"); return; }
    if (action === "open-rollback-dialog" && historyAction?.action === "rollback") {
      Array.from(root.querySelectorAll<HTMLDialogElement>("[data-rollback-dialog]")).find((dialog) => dialog.dataset.batchId === record.batch_id)?.showModal();
      return;
    }
    if (action === "confirm-rollback" && historyAction?.action === "rollback") {
      button.closest<HTMLDialogElement>("dialog")?.close();
      startOperation(record, "rollback");
    }
  });
  void api.listPublications().then((loadedRecords) => { records = loadedRecords; render(); }).catch(() => { message = "发布历史暂时无法加载。"; render(); });
}
