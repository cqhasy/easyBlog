import { listPublications, retryRelease, rollbackPublication } from "../../bridge/releases";
import type { PublicationRecord } from "../../contracts";

export const historyFeature = "history";

type HistoryApi = { listPublications: () => Promise<PublicationRecord[]>; retryRelease: (input: { batch_id: string }) => Promise<void>; rollbackPublication: (input: { batch_id: string }) => Promise<string> };

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (state: PublicationRecord["state"]) => state === "pending_push" ? "等待推送" : state === "rollback_pending" ? "等待推送回滚" : state === "rolled_back" ? "已回滚" : "已发布";

export function renderHistory(records: PublicationRecord[], message = ""): string {
  const rows = records.length ? records.map((record) => { const retry = record.state === "pending_push"; const rollbackRetry = record.state === "rollback_pending"; return `<li class="history-row"><div><strong>${escapeHtml(record.commit_sha)}</strong><span>${escapeHtml(record.scope_id)} · ${record.change_ids.length} 项变更</span></div><div class="history-meta"><span class="publication-state state-${record.state}">${label(record.state)}</span><time>${escapeHtml(record.published_at ?? "提交已创建，尚未推送")}</time></div><button class="secondary-button" type="button" data-action="${retry ? "retry" : "rollback"}" data-batch-id="${escapeHtml(record.batch_id)}" ${record.state === "rolled_back" ? "disabled" : ""}>${retry ? "重试推送" : rollbackRetry ? "重试回滚推送" : "回滚"}</button></li>`; }).join("") : `<li class="history-empty">尚无发布记录</li>`;
  return `<main class="history-page"><header class="changes-header"><div><p class="eyebrow">EASYBLOG / HISTORY</p><h1>发布历史</h1><p>已发布提交可生成新的反向提交，不会改写远程历史。</p></div><button type="button" data-action="refresh-history">刷新</button></header>${message ? `<p class="history-message" role="status">${escapeHtml(message)}</p>` : ""}<ul class="history-list">${rows}</ul></main>`;
}

export function mountHistory(root: HTMLElement, api: HistoryApi = { listPublications, retryRelease, rollbackPublication }): void {
  let records: PublicationRecord[] = []; let message = "";
  const render = () => { root.innerHTML = renderHistory(records, message); };
  const refresh = () => { void api.listPublications().then((value) => { records = value; render(); }).catch(() => { message = "发布历史暂时无法加载。"; render(); }); };
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]"); if (!button) return;
    const action = button.dataset.action; if (action === "refresh-history") { refresh(); return; }
    const record = records.find((item) => item.batch_id === button.dataset.batchId); if (!record) return;
    if (action === "rollback" && record.state === "published" && !window.confirm(`确认回滚提交 ${record.commit_sha}？这将创建并推送新的反向提交。`)) return;
    message = action === "retry" ? "正在重试推送..." : record.state === "rollback_pending" ? "正在重试回滚推送..." : "正在创建回滚提交..."; render();
    const operation = action === "retry" ? api.retryRelease({ batch_id: record.batch_id }) : api.rollbackPublication({ batch_id: record.batch_id });
    void operation.then(() => { message = action === "retry" ? "发布已推送。" : "回滚提交已推送。"; refresh(); }).catch(() => { message = action === "retry" ? "重试推送未完成。" : "回滚未完成，回滚提交会保留以便重试。"; render(); });
  });
  void api.listPublications().then((loadedRecords) => { records = loadedRecords; render(); }).catch(() => { message = "发布历史暂时无法加载。"; render(); });
}
