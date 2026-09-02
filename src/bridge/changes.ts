import { invoke } from "@tauri-apps/api/core";
import type { Change, ChangeSet, ScopeId } from "../contracts";

export function scanScope(scopeId: ScopeId): Promise<ChangeSet> {
  return invoke<ChangeSet>("scan_scope", { scopeId });
}

export function listChanges(scopeId: ScopeId): Promise<Change[]> {
  return invoke<Change[]>("list_changes", { scopeId });
}
