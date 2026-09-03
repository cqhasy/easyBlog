import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { connectTarget, githubAuthorizationStatus, initializeTarget, inspectTargetConfiguration, listGithubRepositories, listTargets, previewTargetInitialization, refreshGithubRepositoryPermissions, saveTargetConfiguration, startGithubLogin } from "./targets";

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

  it("lists repositories and reloads permissions", async () => {
    invoke.mockResolvedValue([]);
    await listGithubRepositories();
    await refreshGithubRepositoryPermissions();
    expect(invoke).toHaveBeenNthCalledWith(1, "list_github_repositories");
    expect(invoke).toHaveBeenNthCalledWith(2, "refresh_github_repository_permissions");
  });

  it("checks and starts GitHub CLI authorization through Tauri", async () => {
    invoke.mockResolvedValue({ state: "ready", login: "octocat" });
    await githubAuthorizationStatus();
    await startGithubLogin();
    expect(invoke).toHaveBeenNthCalledWith(1, "github_authorization_status");
    expect(invoke).toHaveBeenNthCalledWith(2, "start_github_login");
  });

  it("inspects, saves, previews, and confirms target configuration through Tauri", async () => {
    invoke.mockResolvedValue({});
    await inspectTargetConfiguration("target-1");
    await saveTargetConfiguration({ target_id: "target-1", adapter: "astro_content", posts_directory: "src/content/posts", resources_directory: "src/assets/easyblog" });
    await previewTargetInitialization("target-1");
    await initializeTarget("target-1");
    expect(invoke).toHaveBeenNthCalledWith(1, "inspect_target_configuration", { targetId: "target-1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "save_target_configuration", { targetId: "target-1", adapter: "astro_content", postsDirectory: "src/content/posts", resourcesDirectory: "src/assets/easyblog" });
    expect(invoke).toHaveBeenNthCalledWith(3, "preview_target_initialization", { targetId: "target-1" });
    expect(invoke).toHaveBeenNthCalledWith(4, "initialize_target", { targetId: "target-1", confirmed: true });
  });
});
