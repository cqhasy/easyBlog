import { invoke } from "@tauri-apps/api/core";
import type { ConnectedTarget, GithubAuthorization, GithubRepository } from "../contracts";

export function githubAuthorizationStatus(): Promise<GithubAuthorization> {
  return invoke<GithubAuthorization>("github_authorization_status");
}

export function startGithubLogin(): Promise<GithubAuthorization> {
  return invoke<GithubAuthorization>("start_github_login");
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

export function initializeTarget(targetId: string): Promise<ConnectedTarget> {
  return invoke<ConnectedTarget>("initialize_target", { targetId });
}
