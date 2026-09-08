import { describe, expect, it } from "vitest";
import { reduceStartupState, startupStateForAuthorization } from "./startup-state";

describe("startup state", () => {
  it("admits only a confirmed ready GitHub status", () => {
    expect(startupStateForAuthorization({ state: "ready", login: "octocat" }))
      .toEqual({ kind: "ready", account: { login: "octocat" } });
    expect(startupStateForAuthorization({ state: "unauthenticated", login: null }))
      .toEqual({ kind: "authorization-required", reason: "unauthenticated" });
  });

  it("keeps login failures outside the authenticated shell", () => {
    expect(reduceStartupState(
      { kind: "authorizing" },
      { type: "login-failed", message: "GitHub authorization was not completed." },
    )).toEqual({
      kind: "authorization-required",
      reason: "login-failed",
      message: "GitHub authorization was not completed.",
    });
  });

  it("keeps an authorization launch in the browser handoff state", () => {
    expect(reduceStartupState(
      { kind: "authorizing" },
      { type: "login-started", deviceCode: "534D-B889" },
    )).toEqual({ kind: "awaiting-browser-authorization", deviceCode: "534D-B889" });
  });

  it("admits a browser handoff only after a confirmed ready status", () => {
    expect(reduceStartupState(
      { kind: "awaiting-browser-authorization", deviceCode: "534D-B889" },
      { type: "authorization-checked", authorization: { state: "unauthenticated", login: null } },
    )).toEqual({ kind: "awaiting-browser-authorization", deviceCode: "534D-B889" });
    expect(reduceStartupState(
      { kind: "awaiting-browser-authorization", deviceCode: "534D-B889" },
      { type: "authorization-checked", authorization: { state: "ready", login: "octocat" } },
    )).toEqual({ kind: "ready", account: { login: "octocat" } });
  });

  it("removes ready state after a later non-ready revalidation", () => {
    expect(reduceStartupState(
      { kind: "ready", account: { login: "octocat" } },
      { type: "authorization-checked", authorization: { state: "missing_cli", login: null } },
    )).toEqual({ kind: "authorization-required", reason: "missing-cli" });
  });
});
