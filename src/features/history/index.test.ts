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
    operations: [
      { target_path: "posts/release-notes.md", object_kind: "article", change_kind: "added", display_name: "Release notes" },
      { target_path: "assets/cover.png", object_kind: "resource", change_kind: "updated", display_name: "cover.png" },
      { target_path: "posts/archive.md", object_kind: "article", change_kind: "deleted", display_name: "Archived note" },
      { target_path: "posts/fourth.md", object_kind: "article", change_kind: "updated", display_name: "Fourth item" },
    ],
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
    operations: null,
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
  it("renders a publication as a content-first event and expands its remaining objects", () => {
    const record = publishedRecord();
    const collapsed = renderHistory([record]);
    const expanded = renderHistory([record], "", new Set([record.batch_id]));

    expect(collapsed).toContain("Release notes");
    expect(collapsed).toContain("新增");
    expect(collapsed).toContain("posts/release-notes.md");
    expect(collapsed).toContain("展开全部 4 项");
    expect(collapsed).not.toContain("Fourth item");
    expect(expanded).toContain("Fourth item");
    expect(expanded).toContain('aria-expanded="true"');
  });

  it("places eligible rollback in an overflow action and renders a confirmation dialog", () => {
    const record = publishedRecord();
    const html = renderHistory([record]);

    expect(html).toContain('data-action="open-history-menu"');
    expect(html).toContain('data-lucide="ellipsis-vertical"');
    expect(html).not.toContain('data-action="rollback"');
    expect(renderRollbackDialog(record)).toContain('data-action="confirm-rollback"');
    expect(renderRollbackDialog(record)).toContain(`title="${record.commit_sha}"`);
    expect(renderRollbackDialog(record)).toContain('class="history-dialog-details"');
    expect(renderRollbackDialog(record)).toContain('class="history-dialog-actions"');
    expect(renderRollbackDialog(record)).toContain("受影响内容");
    expect(renderRollbackDialog(record)).toContain("4 项");
    expect(renderRollbackDialog(record)).toContain('role="dialog" aria-modal="true"');
    expect(renderRollbackDialog(record)).toContain(`aria-describedby="rollback-description-${record.batch_id}"`);
  });

  it("labels the publication history region with its page heading", () => {
    const html = renderHistory([publishedRecord()]);

    expect(html).toContain('<section class="history-page" aria-labelledby="history-title">');
    expect(html).toContain('<h1 id="history-title">发布历史</h1>');
  });

  it("explains unavailable rollback without rendering an enabled action", () => {
    const html = renderHistory([legacyRecord()]);

    expect(html).toContain("单项文件变更不可用，且无法自动回滚。");
    expect(html).not.toContain("This legacy release cannot be rolled back.");
    expect(html).not.toContain('data-action="confirm-rollback"');
    expect(html).not.toContain('class="history-operation"');
  });

  it("renders retry for a pending publication instead of a rollback action", () => {
    const record = { ...publishedRecord(), state: "pending_push" as const };
    const html = renderHistory([record]);

    expect(html).toContain("重试推送");
    expect(html).not.toContain('data-action="open-rollback-dialog"');
  });

  it("updates the timeline when an event is expanded", async () => {
    const root = new HistoryDomRoot();

    mountHistory(root as unknown as HTMLElement, {
      listPublications: async () => [publishedRecord()],
      retryRelease: async () => undefined,
      rollbackPublication: async () => "rollback-commit",
    });

    await flushDomUpdates();
    expect(root.innerHTML).not.toContain("Fourth item");
    root.clickAction("toggle-history-event", "batch-published");

    expect(root.innerHTML).toContain("Fourth item");
    expect(root.innerHTML).toContain('aria-expanded="true"');
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

  it("explains a rollback that could not start without exposing a long commit identifier", async () => {
    const root = new HistoryDomRoot();

    mountHistory(root as unknown as HTMLElement, {
      listPublications: async () => [publishedRecord()],
      retryRelease: async () => undefined,
      rollbackPublication: async () => { throw { code: "publication_not_reversible", message: "Another target operation is already active" }; },
    });

    await flushDomUpdates();
    root.clickAction("confirm-rollback", "batch-published");
    await flushDomUpdates();

    expect(root.innerHTML).toContain("回滚未启动：此发布目标正在执行另一项操作。原发布记录仍为已发布；请等待该操作完成后，从本条记录的操作菜单再次回滚。");
    expect(root.innerHTML).toContain('state-published');
    expect(root.innerHTML).toContain('data-action="open-rollback-dialog"');
    expect(root.innerHTML).not.toContain("提交 published-commit 的回滚未完成");
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
    let resolveRefresh!: (records: PublicationRecord[]) => void;
    const listPublications = vi.fn()
      .mockResolvedValueOnce([publishedRecord()])
      .mockImplementationOnce(() => new Promise<PublicationRecord[]>((resolve) => { resolveRefresh = resolve; }));

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
    expect(root.innerHTML).toContain("正在创建回滚提交…");
    expect(root.innerHTML).not.toContain("提交 published-commit 的回滚未完成，回滚提交会保留以便重试。");
    expect(root.innerHTML).not.toContain('data-action="retry"');

    resolveRefresh([pendingRollback]);
    await flushDomUpdates();

    expect(root.innerHTML).toContain("回滚未完成。请查看此记录的当前状态后重试。");
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
