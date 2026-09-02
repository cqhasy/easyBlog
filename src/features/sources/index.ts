import { addSource, listSources } from "../../bridge/sources";
import type { AddSourceInput } from "../../bridge/sources";
import type { Source } from "../../contracts";

export const sourcesFeature = "sources";

export type SourcesApi = {
  listSources: () => Promise<Source[]>;
  addSource?: (input: AddSourceInput) => Promise<Source>;
};

export type SourcesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; sources: Source[] }
  | { status: "error"; message: string };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export async function loadSources(api: SourcesApi = { listSources }): Promise<SourcesState> {
  try {
    const sources = await api.listSources();
    return sources.length === 0 ? { status: "empty" } : { status: "ready", sources };
  } catch (error) {
    return {
      status: "error",
      message: errorMessage(error, "Sources could not be loaded"),
    };
  }
}

export async function addSourceAndReload(
  api: Required<SourcesApi>,
  input: AddSourceInput,
): Promise<SourcesState> {
  await api.addSource(input);
  return loadSources(api);
}

export function createSourcesRefreshController(
  api: SourcesApi,
  apply: (state: SourcesState) => void,
): { begin: () => number; isCurrent: (generation: number) => boolean; refresh: () => Promise<void> } {
  let generation = 0;
  const begin = () => ++generation;
  const isCurrent = (requestGeneration: number) => requestGeneration === generation;
  const refresh = async () => {
    const requestGeneration = begin();
    apply({ status: "loading" });
    const nextState = await loadSources(api);
    if (isCurrent(requestGeneration)) apply(nextState);
  };
  return { begin, isCurrent, refresh };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

export function formatSourcePath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  return path.startsWith("\\\\?\\") ? path.slice(4) : path;
}

export function renderSources(state: SourcesState): string {
  const content =
    state.status === "loading"
      ? '<p class="sources-status" role="status">正在加载来源...</p>'
      : state.status === "error"
        ? `<div class="sources-error" role="alert"><strong>来源加载失败</strong><span>${escapeHtml(state.message)}</span><button type="button" data-action="retry">重试</button></div>`
        : state.status === "empty"
          ? '<p class="sources-status sources-empty">尚未添加本地目录</p>'
          : `<ul class="source-list">${state.sources
              .map(
                (source) =>
                  `<li><div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(formatSourcePath(source.path))}</span></div><time datetime="${escapeHtml(source.created_at)}">${escapeHtml(source.created_at)}</time></li>`,
              )
              .join("")}</ul>`;

  return `<section class="sources-page" aria-labelledby="sources-title">
    <header class="sources-header"><div><p class="eyebrow">SOURCE REGISTRY</p><h1 id="sources-title">内容来源</h1><p class="sources-subtitle">管理用于后续 Markdown 检测的本地目录。</p></div><span class="source-count">${state.status === "ready" ? state.sources.length : 0} 个来源</span></header>
    <form class="source-form" id="add-source-form"><label>目录路径<input name="path" required placeholder="例如：C:\\Users\\you\\Documents\\blog" /></label><label>显示名称<span class="optional">可选</span><input name="name" placeholder="留空使用目录名" /></label><button type="submit">添加目录</button></form>
    <div class="sources-content">${content}</div>
  </section>`;
}

export function mountSources(root: HTMLElement, api: SourcesApi = { listSources, addSource }): void {
  let state: SourcesState = { status: "loading" };
  const render = () => {
    root.innerHTML = renderSources(state);
  };
  const refreshController = createSourcesRefreshController(api, (nextState) => {
    state = nextState;
    render();
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "add-source-form" || !api.addSource) return;
    event.preventDefault();
    const data = new FormData(form);
    const requestGeneration = refreshController.begin();
    try {
      state = { status: "loading" };
      render();
      const nextState = await addSourceAndReload(api as Required<SourcesApi>, {
        path: String(data.get("path") ?? ""),
        name: String(data.get("name") ?? "") || undefined,
      });
      if (refreshController.isCurrent(requestGeneration)) {
        state = nextState;
        render();
      }
    } catch (error) {
      if (refreshController.isCurrent(requestGeneration)) {
        state = { status: "error", message: errorMessage(error, "Source could not be added") };
        render();
      }
    }
  });
  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-action=retry]")) void refreshController.refresh();
  });
  render();
  void refreshController.refresh();
}
