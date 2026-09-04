import { describe, expect, it, vi } from "vitest";

import { mountHistory, renderHistory, renderRollbackDialog } from "./index";
import type { PublicationRecord } from "../../contracts";

function publishedRecord(): PublicationRecord {
  return {
    batch_id: "batch-published",
    commit_sha: "published-commit",
    scope_id: "scope-1",
    target_id: "target-1",
    change_ids: ["change-1", "change-2"],
    state: "published",
    published_at: "2026-09-04T08:00:00Z",
    rollback_commit_sha: null,
    rolled_back_at: null,
  };
}

function legacyRecord(): PublicationRecord {
  return {
    batch_id: "legacy",
    commit_sha: "old",
    scope_id: "scope",
    target_id: "target",
    change_ids: [],
    state: "legacy",
    published_at: "2026-09-03T00:00:00Z",
    recovery_reason: "This legacy release cannot be rolled back.",
    rollback_commit_sha: null,
    rolled_back_at: null,
  };
}

class HistoryDomRoot {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  clickAction(action: string, batchId?: string): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const dialog = { close: vi.fn() };
    const target = {
      dataset: batchId ? { action, batchId } : { action },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : selector === "dialog" ? dialog as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
    this.lastDialog = dialog;
  }

  lastDialog: { close: ReturnType<typeof vi.fn> } | undefined;
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("history", () => {
  it("places eligible rollback in an overflow action and renders a confirmation dialog", () => {
    const record = publishedRecord();
    const html = renderHistory([record]);

    expect(html).toContain('data-action="open-history-menu"');
    expect(html).not.toContain('data-action="rollback"');
    expect(renderRollbackDialog(record)).toContain('data-action="confirm-rollback"');
    expect(renderRollbackDialog(record)).toContain(record.commit_sha);
  });

  it("explains unavailable rollback without rendering an enabled action", () => {
    const html = renderHistory([legacyRecord()]);

    expect(html).toContain("旧版发布记录没有可安全执行的文件操作清单。");
    expect(html).not.toContain("This legacy release cannot be rolled back.");
    expect(html).not.toContain('data-action="confirm-rollback"');
  });

  it("calls rollback once while its confirmation is pending", async () => {
    const root = new HistoryDomRoot();
    const rollback = vi.fn(() => new Promise<string>(() => undefined));

    mountHistory(root as unknown as HTMLElement, {
      listPublications: async () => [publishedRecord()],
      retryRelease: async () => undefined,
      rollbackPublication: rollback,
    });

    await flushDomUpdates();
    root.clickAction("confirm-rollback", "batch-published");
    root.clickAction("confirm-rollback", "batch-published");

    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledWith({ batch_id: "batch-published" });
  });

  it("holds the rollback guard until refreshed records arrive", async () => {
    const root = new HistoryDomRoot();
    let resolveRollback!: (commitSha: string) => void;
    let resolveRefresh!: (records: PublicationRecord[]) => void;
    const rollback = vi.fn(() => new Promise<string>((resolve) => { resolveRollback = resolve; }));
    const listPublications = vi.fn()
      .mockResolvedValueOnce([publishedRecord()])
      .mockImplementationOnce(() => new Promise<PublicationRecord[]>((resolve) => { resolveRefresh = resolve; }));

    mountHistory(root as unknown as HTMLElement, {
      listPublications,
      retryRelease: async () => undefined,
      rollbackPublication: rollback,
    });

    await flushDomUpdates();
    root.clickAction("confirm-rollback", "batch-published");
    resolveRollback("reverse-commit");
    await flushDomUpdates();
    root.clickAction("confirm-rollback", "batch-published");

    expect(rollback).toHaveBeenCalledOnce();
    resolveRefresh([]);
  });

  it("refreshes a rejected rollback into a retryable pending action", async () => {
    const root = new HistoryDomRoot();
    const pendingRollback = { ...publishedRecord(), state: "rollback_pending" as const, rollback_commit_sha: "reverse-commit" };
    const listPublications = vi.fn()
      .mockResolvedValueOnce([publishedRecord()])
      .mockResolvedValueOnce([pendingRollback]);

    mountHistory(root as unknown as HTMLElement, {
      listPublications,
      retryRelease: async () => undefined,
      rollbackPublication: async () => { throw new Error("push failed"); },
    });

    await flushDomUpdates();
    root.clickAction("confirm-rollback", "batch-published");
    await flushDomUpdates();
    await flushDomUpdates();

    expect(listPublications).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toContain("提交 published-commit 的回滚未完成，回滚提交会保留以便重试。");
    expect(root.innerHTML).toContain('data-action="retry"');
    expect(root.innerHTML).toContain("重试回滚推送");
  });

  it("closes the rollback dialog when canceled without a batch identifier", async () => {
    const root = new HistoryDomRoot();

    mountHistory(root as unknown as HTMLElement, {
      listPublications: async () => [publishedRecord()],
      retryRelease: async () => undefined,
      rollbackPublication: async () => "rollback-commit",
    });

    await flushDomUpdates();
    root.clickAction("cancel-rollback");

    expect(root.lastDialog?.close).toHaveBeenCalledOnce();
  });
});
