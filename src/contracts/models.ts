export type SourceId = string;
export type ScopeId = string;
export type TargetId = string;
export type ChangeId = string;
export type ReleaseBatchId = string;

export interface Source {
  id: string;
  path: string;
  name: string;
  type: "local_directory";
  created_at: string;
}

export type ScopeLifecycle = "active" | "paused" | "deleted";
export type ScopeHealth = "ready" | "needs_target" | "blocked";
export type SourceNodeKind = "local_path" | "feishu_document" | "feishu_wiki_node";

export interface SourceNodeRef { kind: SourceNodeKind; value: string; }
export interface ScopeSelection { node: SourceNodeRef; recursive: boolean; display_name: string; }
export interface Scope {
  id: ScopeId;
  source_id: SourceId;
  target_id: TargetId | null;
  name: string;
  lifecycle: ScopeLifecycle;
  revision: number;
  selections: ScopeSelection[];
  include_patterns: string[];
  exclude_patterns: string[];
  created_at: string;
  updated_at: string;
}
export interface ScopeDiagnostic { code: string; message: string; }
export interface ScopeSummary { scope: Scope; health: ScopeHealth; diagnostics: ScopeDiagnostic[]; }
export interface SaveScopeInput {
  id?: ScopeId;
  source_id: SourceId;
  target_id: TargetId | null;
  name: string;
  lifecycle: ScopeLifecycle;
  selections: ScopeSelection[];
  include_patterns: string[];
  exclude_patterns: string[];
}
export interface SourceTreeNode {
  reference: SourceNodeRef;
  display_name: string;
  kind: "directory" | "markdown";
  selectable: boolean;
  has_children: boolean;
}

export interface PlaceholderModel {
  id: string;
}
