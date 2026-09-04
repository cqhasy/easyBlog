import { invoke } from "@tauri-apps/api/core";
import type { ConnectedTarget, GithubAuthorization, GithubLoginLaunch, GithubRepository, InitializationPreview, LayoutCandidate } from "../contracts";

export function githubAuthorizationStatus(): Promise<GithubAuthorization> {
  return invoke<GithubAuthorization>("github_authorization_status");
}

export function startGithubLogin(): Promise<GithubLoginLaunch> {
  return invoke<GithubLoginLaunch>("start_github_login");
}

export function listTargets(): Promise<ConnectedTarget[]> {
  return invoke<ConnectedTarget[]>("list_targets");
}

export function listGithubRepositories(): Promise<GithubRepository[]> {
  return invoke<GithubRepository[]>("list_github_repositories");
}

export function refreshGithubRepositoryPermissions(): Promise<GithubRepository[]> {
  return invoke<GithubRepository[]>("refresh_github_repository_permissions");
}

export function connectTarget(input: { repository: string; default_branch: string; visibility: "public" | "private" }): Promise<ConnectedTarget> {
  return invoke<ConnectedTarget>("connect_target", {
    repository: input.repository,
    defaultBranch: input.default_branch,
    visibility: input.visibility,
  });
}

export function inspectTargetConfiguration(targetId: string): Promise<LayoutCandidate[]> {
  return invoke<LayoutCandidate[]>("inspect_target_configuration", { targetId });
}

export function saveTargetConfiguration(input: { target_id: string; adapter: "github_pages" | "astro_content"; posts_directory: string; resources_directory: string }): Promise<ConnectedTarget> {
  return invoke<ConnectedTarget>("save_target_configuration", {
    targetId: input.target_id,
    adapter: input.adapter,
    postsDirectory: input.posts_directory,
    resourcesDirectory: input.resources_directory,
  });
}

export function previewTargetInitialization(targetId: string): Promise<InitializationPreview> {
  return invoke<InitializationPreview>("preview_target_initialization", { targetId });
}

export function initializeTarget(targetId: string): Promise<ConnectedTarget> {
  return invoke<ConnectedTarget>("initialize_target", { targetId, confirmed: true });
}
