import { invoke } from "@tauri-apps/api/core";
import type { Source } from "../contracts";

export type AddSourceInput = { path: string; name?: string };

export function listSources(): Promise<Source[]> {
  return invoke<Source[]>("list_sources");
}

export function addSource(input: AddSourceInput): Promise<Source> {
  return invoke<Source>("add_source", input);
}
