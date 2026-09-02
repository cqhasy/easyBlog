import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { connectTarget, listTargets } from "./targets";

describe("targets bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("connects and lists persisted targets through Tauri", async () => {
    invoke.mockResolvedValue({});
    await connectTarget({ workspace_path: "C:/blog", name: "My Blog" });
    await listTargets();
    expect(invoke).toHaveBeenNthCalledWith(1, "connect_target", { workspace_path: "C:/blog", name: "My Blog" });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_targets");
  });
});
