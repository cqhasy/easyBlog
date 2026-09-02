export type SourceId = string;
export type ScopeId = string;
export type TargetId = string;
export type ChangeId = string;
export type ReleaseBatchId = string;

export type GithubAuthorizationState = "ready" | "missing_cli" | "unauthenticated" | "unavailable";
export interface GithubAuthorization {
  state: GithubAuthorizationState;
  login: string | null;
}

export interface Target {
  id: TargetId;
  repository: string;
  default_branch: string;
  visibility: "public" | "private";
  state: "ready" | "needs_configuration" | "needs_recovery" | "needs_reconnect";
  layout?: { posts_directory: string; resources_directory: string };
}
export interface ConnectedTarget extends Target {
  name: string;
  created_at: string;
}
export interface GithubRepository {
  repository: string;
  visibility: "public" | "private";
  default_branch: string;
  description: string | null;
}
export interface ReleaseBatch {
  id: ReleaseBatchId;
  scope_id: ScopeId;
  target_id: TargetId;
  change_ids: ChangeId[];
}
export type FileChangeKind = "added" | "modified" | "deleted" | "unchanged";
export interface FileDiff { path: string; kind: FileChangeKind; patch: string; }
export interface ReleasePlan {
  preview_id: string;
  batch: ReleaseBatch;
  status: "awaiting_confirmation";
  needs_configuration: boolean;
  diffs: FileDiff[];
}
export interface Publication {
  batch_id: ReleaseBatchId;
  commit_sha: string;
  published_at: string;
}
export type PublicationState = "pending_push" | "published" | "rollback_pending" | "rolled_back";
export interface PublicationRecord {
  batch_id: ReleaseBatchId;
  commit_sha: string;
  scope_id: ScopeId;
  target_id: TargetId;
  change_ids: ChangeId[];
  state: PublicationState;
  published_at: string | null;
  rollback_commit_sha: string | null;
  rolled_back_at: string | null;
}

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

export type ChangeKind = "added" | "updated" | "moved" | "deleted" | "blocked";
export interface Snapshot {
  scope_id: ScopeId;
  source_identity: string;
  source_path: string;
  title: string | null;
  fingerprint: string;
  observed_at: string;
}
export interface Change {
  id: ChangeId;
  scope_id: ScopeId;
  kind: ChangeKind;
  source_identity: string;
  source_path: string;
  previous_path: string | null;
  title: string | null;
  selected: boolean;
  blocked_reason: string | null;
  snapshot: Snapshot | null;
}
export interface ChangeSet {
  scope_id: ScopeId;
  scanned_at: string;
  changes: Change[];
}
