import { describe, expect, it } from "vitest";
import { renderChangeReview, renderPublishDialog, type ReviewState } from "./review";
import type { Change, ConnectedTarget, ReleasePlan, ScopeSummary } from "../../contracts";

const scope: ScopeSummary = {
  scope: { id: "scope-1", source_id: "source-1", target_id: "target-1", name: "文章", lifecycle: "active", revision: 1, selections: [], include_patterns: [], exclude_patterns: [], created_at: "now", updated_at: "now" },
  health: "ready",
  diagnostics: [],
};

const target: ConnectedTarget = {
  id: "target-1",
  name: "博客",
  repository: "easyblog/site",
  default_branch: "main",
  visibility: "public",
  state: "ready",
  layout: { posts_directory: "posts", resources_directory: "public" },
  created_at: "now",
};

function change(kind: Change["kind"], id: string = kind): Change {
  return { id, scope_id: "scope-1", kind, source_identity: `${id}.md`, source_path: `${id}.md`, previous_path: null, title: id, selected: true, blocked_reason: null, snapshot: null };
}

function reviewState(selectedChanges: Change[], activeChangeId: string): ReviewState {
  return { status: "ready", scope, selectedChanges, activeChangeId, activeView: "summary" };
}

function plan(batchId: string): ReleasePlan {
  return {
    preview_id: "preview-1",
    batch: { id: batchId, scope_id: "scope-1", target_id: "target-1", change_ids: ["a", "b"] },
    status: "awaiting_confirmation",
    needs_configuration: false,
    diffs: [{ path: "posts/a.md", kind: "modified", patch: "@@ -1 +1 @@" }],
  };
}

describe("focused change review", () => {
  it("renders only selected changes and marks the requested item active", () => {
    const html = renderChangeReview(reviewState([change("added", "a"), change("updated", "b")], "b"));

    expect(html).toContain('data-change-id="a"');
    expect(html).toContain('data-change-id="b" aria-current="true"');
    expect(html).not.toContain("未选择的变更");
  });

  it("renders a final dialog that publishes the persisted batch only", () => {
    const html = renderPublishDialog(plan("batch-1"), target);

    expect(html).toContain('data-action="confirm-publish" data-batch-id="batch-1"');
    expect(html).not.toContain("data-change-id");
  });

  it("shows persisted preview diffs in the focused review pane", () => {
    const html = renderChangeReview({
      status: "preview",
      scope,
      selectedChanges: [change("updated", "a")],
      activeChangeId: "a",
      plan: plan("batch-1"),
      target,
    });

    expect(html).toContain("@@ -1 +1 @@");
  });
});
