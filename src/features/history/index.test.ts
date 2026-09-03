import { describe, expect, it } from "vitest";

import { renderHistory } from "./index";

describe("history", () => {
  it("disables rollback for legacy and recovery-required records", () => {
    const rendered = renderHistory([
      {
        batch_id: "legacy", commit_sha: "old", scope_id: "scope", target_id: "target", change_ids: [],
        state: "legacy", published_at: "2026-09-03T00:00:00Z", rollback_commit_sha: null, rolled_back_at: null,
      },
      {
        batch_id: "recovery", commit_sha: "uncertain", scope_id: "scope", target_id: "target", change_ids: [],
        state: "recovery_required", published_at: null, rollback_commit_sha: null, rolled_back_at: null,
        recovery_reason: "Push result needs reconciliation.",
      },
    ]);

    expect(rendered).toContain('data-batch-id="legacy" disabled');
    expect(rendered).toContain('data-batch-id="recovery" disabled');
    expect(rendered).toContain("旧版发布记录没有可安全执行的文件操作清单。");
    expect(rendered).toContain("Push result needs reconciliation.");
  });
});
