import { describe, expect, it } from "vitest";
import { mountChangeReview, renderChangeReview, renderPublishDialog, type ReviewState } from "./review";
import type { Change, ConnectedTarget, Publication, ReleasePlan, ScopeSummary } from "../../contracts";

const scope: ScopeSummary = {
  scope: { id: "scope-1", source_id: "source-1", target_id: "target-1", name: "文章", lifecycle: "active", revision: 1, selections: [], include_patterns: [], exclude_patterns: [], created_at: "now", updated_at: "now" },
  health: "ready",
  diagnostics: [],
};

const secondScope: ScopeSummary = {
  scope: { id: "scope-2", source_id: "source-2", target_id: "target-1", name: "产品反馈", lifecycle: "active", revision: 1, selections: [], include_patterns: [], exclude_patterns: [], created_at: "now", updated_at: "now" },
  health: "ready",
  diagnostics: [],
};

const target: ConnectedTarget = {
  id: "target-1", name: "博客", repository: "easyblog/site", default_branch: "main", visibility: "public", state: "ready", layout: { posts_directory: "posts", resources_directory: "public" }, created_at: "now",
};

function change(kind: Change["kind"], id: string = kind): Change {
  return { id, scope_id: "scope-1", kind, source_identity: `${id}.md`, source_path: `features/${id}.md`, previous_path: null, title: id, selected: true, blocked_reason: null, snapshot: null };
}

function reviewState(selectedChanges: Change[], activeChangeId: string): ReviewState {
  return { status: "ready", scope, selectedChanges, activeChangeId };
}

function plan(batchId: string): ReleasePlan {
  return {
    preview_id: "preview-1",
    batch: { id: batchId, scope_id: "scope-1", target_id: "target-1", change_ids: ["a", "b"] },
    status: "awaiting_confirmation",
    needs_configuration: false,
    diffs: [{ path: "docs/features/a.md", kind: "modified", patch: "@@ -1 +1 @@\n-old\n+new" }],
  };
}

const publication: Publication = { batch_id: "batch-1", commit_sha: "commit-1", published_at: "now" };

class ReviewDomRoot {
  innerHTML = "";
  private clickHandler: ((event: MouseEvent) => void) | undefined;
  private inputHandler: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") this.clickHandler = listener as (event: MouseEvent) => void;
    if (type === "input" && typeof listener === "function") this.inputHandler = listener as (event: Event) => void;
  }

  clickAction(action: string, attributes: Record<string, string> = {}): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const node = { dataset: { action, ...attributes }, closest: <T extends HTMLElement>(selector: string): T | null => selector === "[data-action]" ? node as unknown as T : null };
    this.clickHandler?.({ target: node } as unknown as MouseEvent);
  }

  search(value: string): void {
    const input = { dataset: { action: "filter-review-changes" }, value };
    this.inputHandler?.({ target: input } as unknown as Event);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("focused change review", () => {
  it("renders a single review surface with a labeled queue search instead of view tabs", () => {
    const html = renderChangeReview(reviewState([change("added", "a")], "a"));
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="搜索评审清单"');
    expect(html).toContain('placeholder="搜索内容…"');
    expect(html).toContain("0 / 1 已查看");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("概览");
    expect(html).not.toContain("Markdown");
  });

  it("filters the selected review queue with its search field", async () => {
    const root = new ReviewDomRoot();
    mountChangeReview(root as unknown as HTMLElement, { listScopes: async () => [scope], listChanges: async () => [change("added", "alpha"), change("updated", "bravo")], listTargets: async () => [target] }, { scopeId: scope.scope.id, selectedChangeIds: ["alpha", "bravo"], activeChangeId: "alpha" }, { backToChanges: () => undefined, openSources: () => undefined });
    await flushDomUpdates();
    root.search("bravo");
    expect(root.innerHTML).not.toContain('data-change-id="alpha"');
    expect(root.innerHTML).toContain('data-change-id="bravo"');
  });

  it("opens a persisted preview on entry instead of attempting to create another one", async () => {
    const root = new ReviewDomRoot();
    let previewRequests = 0;

    mountChangeReview(root as unknown as HTMLElement, {
      listScopes: async () => [scope],
      listChanges: async () => [change("added", "a"), change("updated", "b")],
      listTargets: async () => [target],
      activeReleasePreview: async () => plan("persisted-batch"),
      previewRelease: async () => {
        previewRequests += 1;
        return plan("new-batch");
      },
    }, { scopeId: scope.scope.id, selectedChangeIds: ["a"], activeChangeId: "a" }, { backToChanges: () => undefined, openSources: () => undefined });

    await flushDomUpdates();
    await flushDomUpdates();

    expect(root.innerHTML).toContain("文章 · 本次选择 2 项");
    expect(root.innerHTML).toContain('<h1 id="review-preview-title">发布预览</h1>');
    expect(root.innerHTML).toContain('data-action="confirm-publish" data-batch-id="persisted-batch"');
    expect(previewRequests).toBe(0);
  });

  it("restores the target's persisted preview when entering from another source", async () => {
    const root = new ReviewDomRoot();
    let previewRequests = 0;
    const sourceAChange = change("added", "a");
    const sourceBChange = { ...change("updated", "b"), scope_id: secondScope.scope.id, title: "来自第二来源的变更" };

    mountChangeReview(root as unknown as HTMLElement, {
      listScopes: async () => [scope, secondScope],
      listChanges: async (scopeId) => scopeId === scope.scope.id ? [sourceAChange, change("updated", "b")] : [sourceBChange],
      listTargets: async () => [target],
      activeReleasePreview: async () => plan("persisted-batch"),
      previewRelease: async () => {
        previewRequests += 1;
        return plan("new-batch");
      },
    }, { scopeId: secondScope.scope.id, selectedChangeIds: [sourceBChange.id], activeChangeId: sourceBChange.id }, { backToChanges: () => undefined, openSources: () => undefined });

    await flushDomUpdates();
    await flushDomUpdates();

    expect(root.innerHTML).toContain("文章 · 本次选择 2 项");
    expect(root.innerHTML).toContain('<h1 id="review-preview-title">发布预览</h1>');
    expect(root.innerHTML).toContain('data-change-id="a"');
    expect(root.innerHTML).not.toContain("来自第二来源的变更");
    expect(root.innerHTML).toContain('data-action="confirm-publish" data-batch-id="persisted-batch"');
    expect(previewRequests).toBe(0);
  });

  it("uses icon-only previous and next controls and turns the final next action into preview", () => {
    const first = renderChangeReview(reviewState([change("added", "a"), change("updated", "b")], "a"));
    const last = renderChangeReview(reviewState([change("added", "a"), change("updated", "b")], "b"));
    expect(first).toContain('data-action="previous-review-change" disabled aria-label="查看上一项" title="查看上一项"');
    expect(first).toContain('data-lucide="chevron-right"');
    expect(last).toContain('data-action="preview-release"');
    expect(last).not.toContain('data-action="next-review-change"');
  });

  it("renders an inline source-to-target mapping and hides unified patch metadata", () => {
    const html = renderChangeReview({ status: "preview", scope, selectedChanges: [change("updated", "a")], activeChangeId: "a", plan: plan("batch-1"), target });
    expect(html).toContain("features/a.md");
    expect(html).toContain('data-lucide="arrow-right"');
    expect(html).toContain("docs/features/a.md");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("--- a/");
    expect(html).toContain('<div class="review-diff" role="region" aria-label="文件差异"><div class="review-diff-canvas">');
    expect(html).not.toContain('<pre class="review-diff"');
    expect(html).toContain('class="review-diff-row review-diff-row-deletion"');
    expect(html).toContain('class="review-diff-row review-diff-row-addition"');
    expect(html).toContain('class="review-diff-code"');
    expect(html).toContain('class="review-article-header"');
    expect(html).toContain("文件差异");
  });

  it("gives every review state a unique Chinese labeled page region", () => {
    const states: Array<[ReviewState, string]> = [
      [{ status: "loading" }, "review-loading-title"],
      [reviewState([change("added", "a")], "a"), "review-ready-title"],
      [{ status: "previewing", scope, selectedChanges: [change("added", "a")], activeChangeId: "a" }, "review-previewing-title"],
      [{ status: "preview", scope, selectedChanges: [change("added", "a")], activeChangeId: "a", plan: plan("batch-1"), target }, "review-preview-title"],
      [{ status: "publishing", plan: plan("batch-1"), target }, "review-publishing-title"],
      [{ status: "published", plan: plan("batch-1"), publication }, "review-published-title"],
      [{ status: "error", message: "预览失败", recovery: "retry-preview" }, "review-error-title"],
    ];
    for (const [state, titleId] of states) expect(renderChangeReview(state)).toContain(`<section class="review-page" aria-labelledby="${titleId}"`);
  });

  it("renders a final dialog that publishes the persisted batch only", () => {
    const html = renderPublishDialog(plan("batch-1"), target);
    expect(html).toContain('data-action="confirm-publish" data-batch-id="batch-1"');
    expect(html).toContain('role="dialog" aria-modal="true"');
  });
});
