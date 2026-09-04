import { describe, expect, it } from "vitest";
import {
  createViewState,
  pageForNavigation,
  resolveSidebarMode,
} from "./view-state";

describe("app view state", () => {
  it("maps focused source editor routes back to Sources navigation", () => {
    expect(pageForNavigation({ page: "source-editor", sourceId: "source-1" })).toBe("sources");
    expect(pageForNavigation({ page: "target-editor", targetId: "target-1" })).toBe("sources");
  });

  it("collapses the sidebar for narrow desktop widths without changing preference", () => {
    expect(resolveSidebarMode("expanded", 1200)).toBe("expanded");
    expect(resolveSidebarMode("expanded", 960)).toBe("collapsed");
    expect(resolveSidebarMode("collapsed", 1200)).toBe("collapsed");
  });

  it("keeps each secondary destination as an authenticated shell page", () => {
    const state = createViewState({ page: "dashboard" });
    state.navigate({ page: "account" });
    expect(state.current()).toEqual({ page: "account" });
  });

  it("stores the sidebar preference independently from the current page", () => {
    const state = createViewState({ page: "dashboard" });
    state.setSidebarPreference("collapsed");

    expect(state.sidebarPreference()).toBe("collapsed");
    expect(state.current()).toEqual({ page: "dashboard" });
  });
});
