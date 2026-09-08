import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { activeReleasePreview, discardReleasePreview, listPublications, previewRelease, publishRelease, retryRelease, rollbackPublication } from "./releases";

describe("releases bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("previews the scope-bound target and selected change IDs", async () => {
    invoke.mockResolvedValue({ preview_id: "batch-1" });
    await previewRelease({ scope_id: "scope-1", change_ids: ["change-1"] });
    expect(invoke).toHaveBeenCalledWith("preview_release", { input: { scope_id: "scope-1", change_ids: ["change-1"] } });
  });

  it("loads an existing preview for the current scope", async () => {
    invoke.mockResolvedValue({ preview_id: "batch-1" });
    await activeReleasePreview({ scope_id: "scope-1" });
    expect(invoke).toHaveBeenCalledWith("active_release_preview", { input: { scope_id: "scope-1" } });
  });

  it("discards an abandoned preview batch", async () => {
    invoke.mockResolvedValue(true);
    await discardReleasePreview({ batch_id: "batch-1" });
    expect(invoke).toHaveBeenCalledWith("discard_release_preview", { input: { batch_id: "batch-1" } });
  });

  it("publishes only the persisted preview batch", async () => {
    invoke.mockResolvedValue({ commit_sha: "abc" });
    await publishRelease({ batch_id: "batch-1" });
    expect(invoke).toHaveBeenCalledWith("publish_release", { input: { batch_id: "batch-1" } });
  });

  it("lists and recovers publication records through the stored target", async () => {
    await listPublications();
    expect(invoke).toHaveBeenCalledWith("list_publications");
    await retryRelease({ batch_id: "batch-1" });
    expect(invoke).toHaveBeenCalledWith("retry_release", { input: { batch_id: "batch-1" } });
    await rollbackPublication({ batch_id: "batch-1" });
    expect(invoke).toHaveBeenCalledWith("rollback_publication", { input: { batch_id: "batch-1" } });
  });
});
