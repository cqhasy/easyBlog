import { invoke } from "@tauri-apps/api/core";
import type { ChangeId, Publication, ReleasePlan, ScopeId, Target } from "../contracts";

export function previewRelease(input: { scope_id: ScopeId; target: Target; change_ids: ChangeId[] }): Promise<ReleasePlan> {
  return invoke<ReleasePlan>("preview_release", { input });
}

export function publishRelease(input: { scope_id: ScopeId; target: Target; change_ids: ChangeId[] }): Promise<Publication> {
  return invoke<Publication>("publish_release", { input });
}
