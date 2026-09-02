import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { previewRelease, publishRelease } from "./releases";

describe("releases bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("previews an explicit target and selected change IDs", async () => {
    invoke.mockResolvedValue({ preview_id: "batch-1" });
    await previewRelease({ scope_id: "scope-1", target: { id: "target-1", workspace_path: "C:/blog" }, change_ids: ["change-1"] });
    expect(invoke).toHaveBeenCalledWith("preview_release", { input: { scope_id: "scope-1", target: { id: "target-1", workspace_path: "C:/blog" }, change_ids: ["change-1"] } });
  });

  it("publishes only an explicit confirmed selection", async () => {
    invoke.mockResolvedValue({ commit_sha: "abc" });
    await publishRelease({ scope_id: "scope-1", target: { id: "target-1", workspace_path: "C:/blog" }, change_ids: ["change-1"] });
    expect(invoke).toHaveBeenCalledWith("publish_release", { input: { scope_id: "scope-1", target: { id: "target-1", workspace_path: "C:/blog" }, change_ids: ["change-1"] } });
  });
});
