import { describe, expect, it } from "vitest";
import { renderAppShell } from "./bootstrap";
import { createViewState } from "./view-state";

describe("app view state", () => {
  it("returns from focused review to the originating change selection", () => {
    const state = createViewState({ page: "changes", scopeId: "scope-1" });
    state.openReview("scope-1", ["change-a", "change-b"], "change-b");

    expect(state.current()).toEqual({
      page: "review",
      scopeId: "scope-1",
      selectedChangeIds: ["change-a", "change-b"],
      activeChangeId: "change-b",
    });

    state.backFromReview();
    expect(state.current()).toEqual({
      page: "changes",
      scopeId: "scope-1",
      selectedChangeIds: ["change-a", "change-b"],
    });
  });

  it("copies selected change IDs when navigating", () => {
    const selection = ["change-a"];
    const state = createViewState({ page: "workbench" });

    state.navigate({ page: "changes", scopeId: "scope-1", selectedChangeIds: selection });
    selection.push("change-b");

    expect(state.current()).toEqual({
      page: "changes",
      scopeId: "scope-1",
      selectedChangeIds: ["change-a"],
    });
  });

  it("marks the active primary navigation item and labels the GitHub top bar", () => {
    const html = renderAppShell(
      { page: "changes" },
      { state: "ready", login: "easyblog" },
    );

    expect(html).toContain('data-page="changes" class="is-active" aria-current="page"');
    expect(html).toContain('class="app-topbar" aria-label="当前页面与 GitHub 状态"');
    expect(html).toContain('class="github-status"');
    expect(html).not.toContain('class="github-authorization"');
  });

  it("provides the single labeled application main landmark", () => {
    const html = renderAppShell({ page: "workbench" });

    expect(html).toContain('<main class="app-content" data-app-content aria-label="应用主内容"></main>');
  });
});
