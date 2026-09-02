import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { addSource, getSourceChildren, listScopes, listSources, saveScope, setScopeLifecycle } from "./sources";

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

  it("uses typed scope command payloads", async () => {
    invoke.mockResolvedValue({});
    await listScopes("source-1");
    await saveScope({ source_id: "source-1", target_id: null, name: "Posts", lifecycle: "active", selections: [{ node: { kind: "local_path", value: "." }, recursive: true, display_name: "整个来源" }], include_patterns: [], exclude_patterns: [] });
    await setScopeLifecycle("scope-1", "paused", 2);
    await getSourceChildren("source-1", { kind: "local_path", value: "posts" });
    expect(invoke).toHaveBeenNthCalledWith(1, "list_scopes", { sourceId: "source-1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "save_scope", expect.objectContaining({ input: expect.objectContaining({ name: "Posts" }) }));
    expect(invoke).toHaveBeenNthCalledWith(3, "set_scope_lifecycle", { scopeId: "scope-1", lifecycle: "paused", expectedRevision: 2 });
    expect(invoke).toHaveBeenNthCalledWith(4, "get_source_children", { sourceId: "source-1", parent: { kind: "local_path", value: "posts" } });
  });
});
