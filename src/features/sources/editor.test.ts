import { describe, expect, it } from "vitest";
import type { ConnectedTarget, Source } from "../../contracts";
import {
  renderSourceEditor,
  renderTargetEditor,
  targetEditorDirectoryChanged,
  targetEditorSaveFailed,
  type SourceEditorState,
  type TargetEditorState,
} from "./editor";

const source: Source = {
  id: "source-1",
  path: "C:/content",
  name: "Content",
  type: "local_directory",
  created_at: "2026-09-02T00:00:00Z",
};

const target: ConnectedTarget = {
  id: "target-1",
  name: "Blog",
  repository: "owner/blog",
  default_branch: "main",
  visibility: "public",
  state: "needs_configuration",
  layout: { posts_directory: "", resources_directory: "" },
  created_at: "2026-09-02T00:00:00Z",
};

const editorState: SourceEditorState = {
  source,
  scope: undefined,
  targets: [],
  selections: [],
  includePatterns: [],
  excludePatterns: [],
  children: {},
  expanded: new Set(),
  loading: new Set(),
  dirty: false,
  saving: false,
};

const initialTargetEditorState: TargetEditorState = {
  target,
  candidates: [],
  form: {
    adapter: "astro_content",
    postsDirectory: "content/posts",
    resourcesDirectory: "content/resources",
  },
  dirty: true,
  saving: false,
};

describe("source and target editors", () => {
  it("keeps advanced rules collapsed by default and exposes stable save/cancel commands", () => {
    const html = renderSourceEditor(editorState);

    expect(html).toContain('data-action="back-to-sources"');
    expect(html).toContain('data-action="cancel-edit"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("<details");
    expect(html).not.toContain("open");
  });

  it("preserves entered target configuration after a save error", () => {
    const next = targetEditorSaveFailed(initialTargetEditorState, "目录不可用");

    expect(next.form.postsDirectory).toBe("content/posts");
    expect(next.error).toBe("目录不可用");
  });

  it.each([
    ["postsDirectory", "content/articles"],
    ["resourcesDirectory", "content/assets"],
  ] as const)("clears an initialization preview when %s changes", (field, value) => {
    const next = targetEditorDirectoryChanged({
      ...initialTargetEditorState,
      initialization: { files: ["content/posts", "content/resources"] },
    }, field, value);

    expect(next.form[field]).toBe(value);
    expect(next.initialization).toBeUndefined();
    expect(next.dirty).toBe(true);
  });

  it("marks focused editor primary actions with the blue-gray action class", () => {
    expect(renderSourceEditor(editorState)).toContain('class="task-primary-button add-rule-button" type="button" data-action="add-rule"');
    expect(renderSourceEditor(editorState)).toContain('type="submit" class="task-primary-button"');
    expect(renderTargetEditor(initialTargetEditorState)).toContain('class="task-primary-button"');
  });
});
