import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectedTarget, ScopeSummary, Source } from "../../contracts";
import {
  mountSourceEditor,
  mountTargetEditor,
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

class TestFormElement {
  constructor(
    readonly id: string,
    readonly values: Record<string, string>,
  ) {}
}

class TestFormData {
  constructor(private readonly form: TestFormElement) {}

  get(name: string): string | null {
    return this.form.values[name] ?? null;
  }
}

class EditorDomRoot {
  innerHTML = "";
  private submitHandler: ((event: SubmitEvent) => void) | undefined;
  private clickHandler: ((event: MouseEvent) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "submit" && typeof listener === "function") {
      this.submitHandler = listener as (event: SubmitEvent) => void;
    }
    if (type === "click" && typeof listener === "function") {
      this.clickHandler = listener as (event: MouseEvent) => void;
    }
  }

  submit(id: string, values: Record<string, string>): void {
    this.submitHandler?.({
      target: new TestFormElement(id, values),
      preventDefault: vi.fn(),
    } as unknown as SubmitEvent);
  }

  clickAction(action: string): void {
    expect(this.innerHTML).toContain(`data-action="${action}"`);
    const target = {
      dataset: { action },
      closest: <T extends HTMLElement>(selector: string): T | null =>
        selector === "[data-action]" ? target as unknown as T : null,
    };
    this.clickHandler?.({ target } as unknown as MouseEvent);
  }
}

async function flushDomUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("reports each editor save in its local action area", () => {
    expect(renderSourceEditor({ ...editorState, saving: true }))
      .toContain('class="editor-operation" role="status" aria-live="polite">正在保存同步范围...</p>');
    expect(renderTargetEditor({ ...initialTargetEditorState, saving: true }))
      .toContain('class="editor-operation" role="status" aria-live="polite">正在保存发布目标...</p>');
  });

  it("does not leave the selected page after an inactive source-editor save completes", async () => {
    vi.stubGlobal("HTMLFormElement", TestFormElement);
    vi.stubGlobal("FormData", TestFormData);
    const root = new EditorDomRoot();
    const backToSources = vi.fn();
    let active = true;
    let resolveSave!: (summary: ScopeSummary) => void;
    const saveScope = vi.fn(() => new Promise<ScopeSummary>((resolve) => {
      resolveSave = resolve;
    }));

    mountSourceEditor(root as unknown as HTMLElement, {
      listSources: async () => [source],
      listScopes: async () => [],
      listTargets: async () => [],
      getSourceChildren: async () => [],
      saveScope,
    }, source.id, undefined, { backToSources }, () => active);

    await flushDomUpdates();
    await flushDomUpdates();
    root.submit("source-editor-form", {
      "scope-name": "Unsaved draft",
      "target-id": "",
    });
    active = false;
    resolveSave({ scope: {
      id: "scope-1",
      source_id: source.id,
      target_id: null,
      name: "Unsaved draft",
      lifecycle: "active",
      revision: 1,
      selections: [],
      include_patterns: [],
      exclude_patterns: [],
      created_at: source.created_at,
      updated_at: source.created_at,
    }, health: "ready", diagnostics: [] });
    await flushDomUpdates();

    expect(saveScope).toHaveBeenCalledOnce();
    expect(backToSources).not.toHaveBeenCalled();
  });

  it("does not leave the selected page after an inactive target initialization completes", async () => {
    vi.stubGlobal("HTMLFormElement", TestFormElement);
    vi.stubGlobal("FormData", TestFormData);
    vi.stubGlobal("window", { confirm: vi.fn(() => true) });
    const root = new EditorDomRoot();
    const backToSources = vi.fn();
    let active = true;
    let resolveSave!: (saved: ConnectedTarget) => void;
    let resolveInitialization!: (saved: ConnectedTarget) => void;
    const saveTargetConfiguration = vi.fn(() => new Promise<ConnectedTarget>((resolve) => {
      resolveSave = resolve;
    }));
    const initializeTarget = vi.fn(() => new Promise<ConnectedTarget>((resolve) => {
      resolveInitialization = resolve;
    }));

    mountTargetEditor(root as unknown as HTMLElement, {
      listSources: async () => [],
      listTargets: async () => [target],
      inspectTargetConfiguration: async () => [],
      saveTargetConfiguration,
      previewTargetInitialization: async () => ({
        target_id: target.id,
        files: ["content/posts"],
      }),
      initializeTarget,
    }, target.id, { backToSources }, () => active);

    await flushDomUpdates();
    await flushDomUpdates();
    root.submit("target-editor-form", {
      adapter: "github_pages",
      "posts-directory": "content/posts",
      "resources-directory": "content/resources",
    });
    resolveSave(target);
    await flushDomUpdates();
    await flushDomUpdates();
    root.clickAction("confirm-target-initialization");
    active = false;
    resolveInitialization(target);
    await flushDomUpdates();

    expect(initializeTarget).toHaveBeenCalledOnce();
    expect(backToSources).not.toHaveBeenCalled();
  });
});
