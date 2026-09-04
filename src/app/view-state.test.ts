import { describe, expect, it } from "vitest";
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
});
