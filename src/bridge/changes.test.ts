import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { listChanges, scanScope } from "./changes";

describe("changes bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("scans and lists a scope through typed commands", async () => {
    invoke.mockResolvedValue([]);
    await scanScope("scope-1");
    await listChanges("scope-1");
    expect(invoke).toHaveBeenNthCalledWith(1, "scan_scope", { scopeId: "scope-1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_changes", { scopeId: "scope-1" });
  });
});
