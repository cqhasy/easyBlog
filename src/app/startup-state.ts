import type { GithubAuthorization } from "../contracts/models";

export type AuthorizationReason =
  | "unauthenticated"
  | "missing-cli"
  | "unavailable"
  | "login-failed";

export type StartupState =
  | { kind: "checking" }
  | { kind: "authorization-required"; reason: AuthorizationReason; message?: string }
  | { kind: "authorizing" }
  | { kind: "awaiting-browser-authorization" }
  | { kind: "ready"; account: { login: string | null } }
  | { kind: "error"; message: string };

export type StartupEvent =
  | { type: "begin-check" }
  | { type: "authorization-checked"; authorization: GithubAuthorization }
  | { type: "check-failed"; message: string }
  | { type: "begin-login" }
  | { type: "login-started" }
  | { type: "authorization-expired" }
  | { type: "login-failed"; message: string };

export function startupStateForAuthorization(authorization: GithubAuthorization): StartupState {
  switch (authorization.state) {
    case "ready":
      return { kind: "ready", account: { login: authorization.login } };
    case "unauthenticated":
      return { kind: "authorization-required", reason: "unauthenticated" };
    case "missing_cli":
      return { kind: "authorization-required", reason: "missing-cli" };
    case "unavailable":
    default:
      return { kind: "authorization-required", reason: "unavailable" };
  }
}

export function reduceStartupState(current: StartupState, event: StartupEvent): StartupState {
  switch (event.type) {
    case "begin-check":
      return { kind: "checking" };
    case "authorization-checked": {
      const nextState = startupStateForAuthorization(event.authorization);
      if (current.kind === "awaiting-browser-authorization" && nextState.kind !== "ready") {
        return current;
      }
      return nextState;
    }
    case "check-failed":
      return { kind: "error", message: event.message };
    case "begin-login":
      return { kind: "authorizing" };
    case "login-started":
      return { kind: "awaiting-browser-authorization" };
    case "authorization-expired":
      return {
        kind: "authorization-required",
        reason: "login-failed",
        message: "GitHub 授权尚未完成，请在浏览器完成确认后重试。",
      };
    case "login-failed":
      return {
        kind: "authorization-required",
        reason: "login-failed",
        message: event.message,
      };
  }
}
