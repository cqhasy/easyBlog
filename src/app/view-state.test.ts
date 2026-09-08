import { describe, expect, it } from "vitest";
import {
  createViewState,
  pageForNavigation,
  resolveSidebarMode,
  type AppView,
} from "./view-state";

describe("app view state", () => {
  it("maps focused source editor routes back to Sources navigation", () => {
    expect(pageForNavigation({ page: "source-editor", sourceId: "source-1" })).toBe("sources");
    expect(pageForNavigation({ page: "target-editor", targetId: "target-1" })).toBe("sources");
  });

  it("keeps Dashboard active for source-filtered Changes routes", () => {
    expect(pageForNavigation({
      page: "changes",
      scopeId: "scope-1",
    } as unknown as AppView)).toBe("dashboard");
  });

  it("keeps Dashboard active while a focused review route is open", () => {
    expect(pageForNavigation({
      page: "review",
      scopeId: "scope-1",
      selectedChangeIds: ["change-1"],
      activeChangeId: "change-1",
    } as unknown as AppView)).toBe("dashboard");
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
