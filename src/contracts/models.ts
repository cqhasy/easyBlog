export type SourceId = string;
export type ScopeId = string;
export type ChangeId = string;
export type ReleaseBatchId = string;

export interface Source {
  id: string;
  path: string;
  name: string;
  source_type: "local_directory";
  created_at: string;
}

export interface PlaceholderModel {
  id: string;
}
