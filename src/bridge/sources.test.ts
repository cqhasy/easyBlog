import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { addSource, listSources } from "./sources";

describe("sources bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("lists sources through the list_sources command", async () => {
    invoke.mockResolvedValue([]);
    await listSources();
    expect(invoke).toHaveBeenCalledWith("list_sources");
  });

  it("sends path and optional name to add_source", async () => {
    invoke.mockResolvedValue({});
    await addSource({ path: "C:/content", name: "Content" });
    expect(invoke).toHaveBeenCalledWith("add_source", {
      path: "C:/content",
      name: "Content",
    });
  });
});
