import { describe, expect, it, vi } from "vitest";
import { mountChangeReview, renderChangeReview, renderPublishDialog, type ReviewState } from "./review";
import type { Change, ConnectedTarget, Publication, ReleasePlan, ScopeSummary } from "../../contracts";

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

const publication: Publication = {
  batch_id: "batch-1",
  commit_sha: "commit-1",
  published_at: "now",
};

class ReviewDomRoot {
  innerHTML = "";
  focusedReviewView: string | undefined;
  private clickHandler: ((event: MouseEvent) => void) | undefined;
  private keydownHandler: ((event: KeyboardEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
    if (type === "keydown" && typeof listener === "function") {
      this.keydownHandler = listener as (event: KeyboardEvent) => void;
    }
  }

  querySelector<T extends Element>(selector: string): T | null {
    const match = selector.match(/\[data-review-view="([^"]+)"\]/);
    if (!match) return null;
    return {
      focus: () => { this.focusedReviewView = match[1]; },
    } as unknown as T;
  }

  keydown(view: "summary" | "markdown" | "diff", key: string): ReturnType<typeof vi.fn> {
    expect(this.innerHTML).toContain(`data-review-view="${view}"`);
    const preventDefault = vi.fn();
    const tab = {
      dataset: { reviewView: view },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[role='tab'][data-review-view]" ? tab as unknown as T : null,
    };
    this.keydownHandler?.({ key, preventDefault, target: tab } as unknown as KeyboardEvent);
    return preventDefault;
  }

  clickAction(action: string, attributes: Record<string, string> = {}): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const target = {
      dataset: { action, ...attributes },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("focused change review", () => {
  it("renders only selected changes and marks the requested item active", () => {
    const html = renderChangeReview(reviewState([change("added", "a"), change("updated", "b")], "b"));

    expect(html).toContain('data-change-id="a"');
    expect(html).toContain('data-change-id="b" aria-current="true"');
    expect(html).not.toContain("未选择的变更");
  });

  it("connects review tabs to their labeled panel and reports preview progress locally", () => {
    const html = renderChangeReview(reviewState([change("added", "a")], "a"));
    const previewing = renderChangeReview({
      status: "previewing",
      scope,
      selectedChanges: [change("added", "a")],
      activeChangeId: "a",
      activeView: "summary",
    });

    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="review-tab-summary" role="tab" aria-controls="review-panel-summary"');
    expect(html).toContain('id="review-panel-summary" role="tabpanel" aria-labelledby="review-tab-summary" tabindex="0"');
    expect(previewing).toContain('class="review-operation" role="status" aria-live="polite">正在生成发布预览...</p>');
  });

  it("gives every review state a unique Chinese labeled page region without a nested main landmark", () => {
    const states: Array<[ReviewState, string]> = [
      [{ status: "loading" }, "review-loading-title"],
      [reviewState([change("added", "a")], "a"), "review-ready-title"],
      [{ status: "previewing", scope, selectedChanges: [change("added", "a")], activeChangeId: "a", activeView: "summary" }, "review-previewing-title"],
      [{ status: "preview", scope, selectedChanges: [change("added", "a")], activeChangeId: "a", activeView: "diff", returnView: "summary", plan: plan("batch-1"), target }, "review-preview-title"],
      [{ status: "publishing", plan: plan("batch-1"), target }, "review-publishing-title"],
      [{ status: "published", plan: plan("batch-1"), publication }, "review-published-title"],
      [{ status: "error", message: "预览失败", recovery: "retry-preview" }, "review-error-title"],
    ];

    for (const [state, titleId] of states) {
      const html = renderChangeReview(state);
      expect(html).toContain(`<section class="review-page" aria-labelledby="${titleId}"`);
      expect(html).toContain(`<h1 id="${titleId}"`);
      expect(html).not.toContain("<main");
    }
  });

  it("moves the active review tab with arrow keys and restores focus after rendering", async () => {
    const root = new ReviewDomRoot();

    mountChangeReview(
      root as unknown as HTMLElement,
      {
        listScopes: async () => [scope],
        listChanges: async () => [change("added", "a")],
        listTargets: async () => [target],
      },
      { scopeId: scope.scope.id, selectedChangeIds: ["a"], activeChangeId: "a" },
      { backToChanges: () => undefined, openSources: () => undefined },
    );

    await flushDomUpdates();
    const next = root.keydown("summary", "ArrowRight");

    expect(next).toHaveBeenCalledOnce();
    expect(root.innerHTML).toContain('data-review-view="markdown" aria-selected="true" tabindex="0"');
    expect(root.innerHTML).toContain('data-review-view="summary" aria-selected="false" tabindex="-1"');
    expect(root.focusedReviewView).toBe("markdown");

    root.keydown("markdown", "ArrowLeft");
    expect(root.innerHTML).toContain('data-review-view="summary" aria-selected="true" tabindex="0"');
    expect(root.focusedReviewView).toBe("summary");
  });

  it("shows batch position and moves through the selected sequence with previous and next actions", async () => {
    const root = new ReviewDomRoot();

    mountChangeReview(
      root as unknown as HTMLElement,
      {
        listScopes: async () => [scope],
        listChanges: async () => [change("added", "a"), change("updated", "b")],
        listTargets: async () => [target],
      },
      { scopeId: scope.scope.id, selectedChangeIds: ["a", "b"], activeChangeId: "a" },
      { backToChanges: () => undefined, openSources: () => undefined },
    );

    await flushDomUpdates();

    expect(root.innerHTML).toContain("第 1 / 2 项");
    expect(root.innerHTML).toContain('data-action="previous-review-change" disabled');
    root.clickAction("next-review-change");

    expect(root.innerHTML).toContain("第 2 / 2 项");
    expect(root.innerHTML).toContain('data-change-id="b" aria-current="true"');
    expect(root.innerHTML).toContain('data-action="next-review-change" disabled');
    root.clickAction("previous-review-change");

    expect(root.innerHTML).toContain('data-change-id="a" aria-current="true"');
  });

  it("returns from preview to the same selected item and review tab", async () => {
    const root = new ReviewDomRoot();

    mountChangeReview(
      root as unknown as HTMLElement,
      {
        listScopes: async () => [scope],
        listChanges: async () => [change("added", "a"), change("updated", "b")],
        listTargets: async () => [target],
        previewRelease: async () => plan("batch-1"),
      },
      { scopeId: scope.scope.id, selectedChangeIds: ["a", "b"], activeChangeId: "b" },
      { backToChanges: () => undefined, openSources: () => undefined },
    );

    await flushDomUpdates();
    root.clickAction("change-review-view", { reviewView: "markdown" });
    root.clickAction("preview-release");
    await flushDomUpdates();
    await flushDomUpdates();

    expect(root.innerHTML).toContain('data-action="return-to-review"');
    expect(root.innerHTML).toContain("@@ -1 +1 @@");
    root.clickAction("return-to-review");

    expect(root.innerHTML).toContain('data-change-id="b" aria-current="true"');
    expect(root.innerHTML).toContain('data-review-view="markdown" aria-selected="true" tabindex="0"');
  });

  it("localizes change kinds in the review sequence and summary", () => {
    const html = renderChangeReview(reviewState([
      change("added", "a"),
      change("updated", "b"),
      change("moved", "c"),
      change("deleted", "d"),
      change("blocked", "e"),
    ], "a"));

    expect(html).toContain(">新增<");
    expect(html).toContain(">更新<");
    expect(html).toContain(">移动<");
    expect(html).toContain(">删除<");
    expect(html).toContain(">需要处理<");
    expect(html).not.toContain(">added<");
    expect(html).not.toContain(">updated<");
    expect(html).not.toContain(">moved<");
    expect(html).not.toContain(">deleted<");
    expect(html).not.toContain(">blocked<");
  });

  it("renders a final dialog that publishes the persisted batch only", () => {
    const html = renderPublishDialog(plan("batch-1"), target);

    expect(html).toContain('data-action="confirm-publish" data-batch-id="batch-1"');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('aria-describedby="publish-description"');
    expect(html).not.toContain("data-change-id");
  });

  it("shows persisted preview diffs in the focused review pane", () => {
    const html = renderChangeReview({
      status: "preview",
      scope,
      selectedChanges: [change("updated", "a")],
      activeChangeId: "a",
      activeView: "diff",
      returnView: "summary",
      plan: plan("batch-1"),
      target,
    });

    expect(html).toContain("@@ -1 +1 @@");
  });

  it("uses the review interaction treatment for recovery actions", () => {
    const html = renderChangeReview({
      status: "error",
      message: "预览失败",
      recovery: "retry-preview",
    });

    expect(html).toContain('class="review-primary-button" data-action="retry-preview"');
  });
});
