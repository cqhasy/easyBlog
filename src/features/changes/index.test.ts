import { describe, expect, it } from "vitest";
import { defaultSelectedChanges, groupChanges, loadChanges, renderChanges, selectableChanges } from "./index";
import type { Change, ScopeSummary } from "../../contracts";

const scope: ScopeSummary = {
  scope: { id: "scope-1", source_id: "source-1", target_id: null, name: "文章", lifecycle: "active", revision: 1, selections: [], include_patterns: [], exclude_patterns: [], created_at: "now", updated_at: "now" },
  health: "needs_target",
  diagnostics: [],
};

function change(kind: Change["kind"], id = kind): Change {
  return { id, scope_id: "scope-1", kind, source_identity: `${id}.md`, source_path: `${id}.md`, previous_path: kind === "moved" ? "old.md" : null, title: id, selected: kind !== "deleted" && kind !== "blocked", blocked_reason: kind === "blocked" ? "无法解析内容" : null, snapshot: null };
}

describe("changes workspace", () => {
  it("groups changes in review order while keeping deletions manual by default", () => {
    const changes = [change("deleted"), change("added"), change("blocked"), change("updated")];
    expect(groupChanges(changes).map((group) => group.kind)).toEqual(["blocked", "added", "updated", "deleted"]);
    expect(selectableChanges(changes).map((item) => item.kind)).toEqual(["deleted", "added", "updated"]);
    expect(defaultSelectedChanges(changes).map((item) => item.kind)).toEqual(["added", "updated"]);
  });

  it("renders blocked context and an inactive publish action", () => {
    const html = renderChanges({ status: "ready", scope, changes: [change("blocked")], scannedAt: "2026-09-02T00:00:00Z" });
    expect(html).toContain("需要处理");
    expect(html).toContain("无法解析内容");
    expect(html).toContain("预览发布</button>");
  });

  it("loads persisted changes for the first active scope", async () => {
    const state = await loadChanges({ listScopes: async () => [scope], listChanges: async () => [change("added")], scanScope: async () => ({ changes: [], scanned_at: "now" }) });
    expect(state).toMatchObject({ status: "ready", scope, changes: [expect.objectContaining({ kind: "added" })] });
  });
});
