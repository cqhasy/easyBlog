import { describe, expect, it, vi } from "vitest";
import type { Source } from "../../contracts";
import { addSourceAndReload, formatSourcePath, loadSources, renderSources } from "./index";

const source: Source = {
  id: "source-1",
  path: "C:/content",
  name: "Content",
  source_type: "local_directory",
  created_at: "2026-09-02T00:00:00Z",
};

describe("sources feature", () => {
  it("returns ready state with sources after loading", async () => {
    const state = await loadSources({ listSources: vi.fn().mockResolvedValue([source]) });
    expect(state).toEqual({ status: "ready", sources: [source] });
    expect(renderSources(state)).toContain("C:/content");
  });

  it("returns empty state for no registered sources", async () => {
    const state = await loadSources({ listSources: vi.fn().mockResolvedValue([]) });
    expect(state).toEqual({ status: "empty" });
    expect(renderSources(state)).toContain("尚未添加本地目录");
  });

  it("returns error state when loading fails", async () => {
    const state = await loadSources({
      listSources: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    expect(state).toEqual({ status: "error", message: "database unavailable" });
    expect(renderSources(state)).toContain("database unavailable");
  });

  it("preserves structured Tauri error messages", async () => {
    const state = await loadSources({
      listSources: vi.fn().mockRejectedValue({ code: "duplicate_source", message: "目录已添加" }),
    });
    expect(state).toEqual({ status: "error", message: "目录已添加" });
  });

  it("removes the Windows extended path prefix for display", () => {
    expect(formatSourcePath("\\\\?\\D:\\markdown")).toBe("D:\\markdown");
    expect(formatSourcePath("\\\\?\\UNC\\server\\share")).toBe("\\\\server\\share");
  });

  it("reloads the persisted list after adding a source", async () => {
    const addSource = vi.fn().mockResolvedValue(source);
    const listSources = vi.fn().mockResolvedValue([source]);
    const state = await addSourceAndReload({ addSource, listSources }, { path: "C:/content" });
    expect(addSource).toHaveBeenCalledWith({ path: "C:/content" });
    expect(listSources).toHaveBeenCalledOnce();
    expect(state).toEqual({ status: "ready", sources: [source] });
  });
});
