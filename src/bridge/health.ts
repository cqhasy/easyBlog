import { invoke } from "@tauri-apps/api/core";

export function health(): Promise<string> {
  return invoke<string>("health");
}
