import { invoke } from "@tauri-apps/api/core";
import type { ChangeId, Publication, PublicationRecord, ReleasePlan, ScopeId, Target } from "../contracts";

export function previewRelease(input: { scope_id: ScopeId; target: Target; change_ids: ChangeId[] }): Promise<ReleasePlan> {
  return invoke<ReleasePlan>("preview_release", { input });
}

export function publishRelease(input: { scope_id: ScopeId; target: Target; change_ids: ChangeId[] }): Promise<Publication> {
  return invoke<Publication>("publish_release", { input });
}

export function listPublications(): Promise<PublicationRecord[]> { return invoke<PublicationRecord[]>("list_publications"); }
export function retryRelease(input: { batch_id: string; target: Target }): Promise<void> { return invoke<void>("retry_release", { input }); }
export function rollbackPublication(input: { batch_id: string; target: Target }): Promise<string> { return invoke<string>("rollback_publication", { input }); }
