import { invoke } from "@tauri-apps/api/core";
import type { ScopeLifecycle, ScopeSummary, SaveScopeInput, Source, SourceNodeRef, SourceTreeNode } from "../contracts";

export type AddSourceInput = { path: string; name?: string };

export function listSources(): Promise<Source[]> {
  return invoke<Source[]>("list_sources");
}

export function addSource(input: AddSourceInput): Promise<Source> {
  return invoke<Source>("add_source", input);
}

export function listScopes(sourceId?: string): Promise<ScopeSummary[]> {
  return invoke<ScopeSummary[]>("list_scopes", sourceId ? { sourceId } : undefined);
}

export function saveScope(input: SaveScopeInput, expectedRevision?: number): Promise<ScopeSummary> {
  return invoke<ScopeSummary>("save_scope", { input, expectedRevision });
}

export function setScopeLifecycle(scopeId: string, lifecycle: ScopeLifecycle, expectedRevision: number): Promise<ScopeSummary> {
  return invoke<ScopeSummary>("set_scope_lifecycle", { scopeId, lifecycle, expectedRevision });
}

export function getSourceChildren(sourceId: string, parent?: SourceNodeRef): Promise<SourceTreeNode[]> {
  return invoke<SourceTreeNode[]>("get_source_children", { sourceId, parent });
}
