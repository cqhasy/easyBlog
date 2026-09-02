import { invoke } from "@tauri-apps/api/core";
import type { ConnectedTarget } from "../contracts";

export function listTargets(): Promise<ConnectedTarget[]> {
  return invoke<ConnectedTarget[]>("list_targets");
}

export function connectTarget(input: { workspace_path: string; name?: string }): Promise<ConnectedTarget> {
  return invoke<ConnectedTarget>("connect_target", input);
}
