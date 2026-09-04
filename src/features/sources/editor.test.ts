import { describe, expect, it } from "vitest";
import type { ConnectedTarget, Source } from "../../contracts";
import {
  renderSourceEditor,
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
});
