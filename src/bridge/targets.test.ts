import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { connectTarget, githubAuthorizationStatus, initializeTarget, listGithubRepositories, listTargets, refreshGithubRepositoryPermissions, startGithubLogin } from "./targets";

describe("targets bridge", () => {
  beforeEach(() => invoke.mockReset());

  it("connects and lists persisted targets through Tauri", async () => {
    invoke.mockResolvedValue({});
    await connectTarget({ repository: "octo/blog", default_branch: "main", visibility: "public" });
    await listTargets();
    expect(invoke).toHaveBeenNthCalledWith(1, "connect_target", {
      repository: "octo/blog",
      defaultBranch: "main",
      visibility: "public",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "list_targets");
  });

  it("lists repositories, refreshes permission, and initializes a connected target", async () => {
    invoke.mockResolvedValue([]);
    await listGithubRepositories();
    await refreshGithubRepositoryPermissions();
    await initializeTarget("target-1");
    expect(invoke).toHaveBeenNthCalledWith(1, "list_github_repositories");
    expect(invoke).toHaveBeenNthCalledWith(2, "refresh_github_repository_permissions");
    expect(invoke).toHaveBeenNthCalledWith(3, "initialize_target", { targetId: "target-1" });
  });

  it("checks and starts GitHub CLI authorization through Tauri", async () => {
    invoke.mockResolvedValue({ state: "ready", login: "octocat" });
    await githubAuthorizationStatus();
    await startGithubLogin();
    expect(invoke).toHaveBeenNthCalledWith(1, "github_authorization_status");
    expect(invoke).toHaveBeenNthCalledWith(2, "start_github_login");
  });
});
