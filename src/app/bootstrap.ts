import { mountChanges } from "../features/changes";
import { mountChangeReview } from "../features/changes/review";
import { mountSources } from "../features/sources";
import { mountSourceEditor, mountTargetEditor } from "../features/sources/editor";
import { mountHistory } from "../features/history";
import { mountWorkbench } from "../features/workbench";
import { githubAuthorizationStatus, startGithubLogin } from "../bridge/targets";
import type { GithubAuthorization } from "../contracts";
import { createViewState, type AppView } from "./view-state";
import "../styles.css";

const pageLabels: Record<Extract<AppView["page"], "workbench" | "changes" | "sources" | "history">, string> = {
  workbench: "工作台",
  changes: "变更",
  sources: "来源",
  history: "历史",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character,
  );
}

function githubAuthorizationMarkup(authorization: GithubAuthorization, loading = false): string {
  const detail = authorization.state === "ready"
    ? `已连接 @${authorization.login ?? "GitHub"}`
    : authorization.state === "missing_cli"
      ? "需要安装 GitHub CLI"
      : authorization.state === "unavailable"
        ? "暂时无法检查 GitHub"
        : "尚未连接 GitHub";
  const action = authorization.state === "ready"
    ? '<button type="button" class="github-action" data-action="github-login">重新检查</button>'
    : authorization.state === "missing_cli"
      ? '<a class="github-action" href="https://cli.github.com/" target="_blank" rel="noreferrer">安装 gh</a>'
      : `<button type="button" class="github-action" data-action="github-login" ${loading ? "disabled" : ""}>${loading ? "正在打开 GitHub..." : "连接 GitHub"}</button>`;
  return `<div class="github-status"><strong>GitHub</strong><span>${escapeHtml(detail)}</span>${action}</div>`;
}

export function renderAppShell(
  view: AppView,
  authorization: GithubAuthorization = { state: "unavailable", login: null },
  authorizationLoading = false,
): string {
  const currentPage = view.page === "review" ? "changes" : view.page === "source-editor" || view.page === "target-editor" ? "sources" : view.page;
  const nav = (Object.keys(pageLabels) as Array<keyof typeof pageLabels>).map((page) => {
    const active = currentPage === page;
    return `<button type="button" data-page="${page}" ${active ? 'class="is-active" aria-current="page"' : ""}>${pageLabels[page]}</button>`;
  }).join("");
  const pageLabel = pageLabels[currentPage as keyof typeof pageLabels] ?? "easyBlog";
  return `<div class="app-shell"><aside class="app-nav" aria-label="主导航"><div class="app-brand" aria-label="easyBlog">easy<span>Blog</span></div><nav aria-label="页面导航">${nav}</nav></aside><section class="app-frame"><header class="app-topbar" aria-label="当前页面与 GitHub 状态" data-github-authorization><span class="app-page-label">${pageLabel}</span>${githubAuthorizationMarkup(authorization, authorizationLoading)}</header><main class="app-content" data-app-content></main></section></div>`;
}

export function bootstrap(root: HTMLElement | null): void {
  if (!root) return;

  const viewState = createViewState({ page: "workbench" });
  let githubAuthorization: GithubAuthorization = { state: "unavailable", login: null };
  let githubAuthorizationLoading = false;
  let githubAuthorizationGeneration = 0;

  const renderShell = () => {
    root.innerHTML = renderAppShell(viewState.current(), githubAuthorization, githubAuthorizationLoading);
  };
  const renderGithubAuthorization = () => {
    const topbar = root.querySelector<HTMLElement>("[data-github-authorization]");
    if (!topbar) return;
    const view = viewState.current();
    const currentPage = view.page === "review" ? "changes" : view.page === "source-editor" || view.page === "target-editor" ? "sources" : view.page;
    const pageLabel = pageLabels[currentPage as keyof typeof pageLabels] ?? "easyBlog";
    topbar.innerHTML = `<span class="app-page-label">${pageLabel}</span>${githubAuthorizationMarkup(githubAuthorization, githubAuthorizationLoading)}`;
  };
  const renderCurrentView = () => {
    renderShell();
    const content = root.querySelector<HTMLElement>("[data-app-content]");
    if (!content) return;
    const view = viewState.current();
    if (view.page === "workbench") {
      mountWorkbench(content, undefined, {
        openChanges: (scopeId) => navigate({ page: "changes", scopeId }),
        openSources: () => navigate({ page: "sources" }),
      });
      return;
    }
    if (view.page === "changes") {
      mountChanges(content, undefined, {
        openReview: (context) => {
          viewState.openReview(context.scopeId, context.selectedChangeIds, context.activeChangeId);
          renderCurrentView();
        },
        openSources: () => navigate({ page: "sources" }),
      }, {
        scopeId: view.scopeId,
        selectedChangeIds: view.selectedChangeIds,
      });
      return;
    }
    if (view.page === "review") {
      mountChangeReview(content, undefined, {
        scopeId: view.scopeId,
        selectedChangeIds: view.selectedChangeIds,
        activeChangeId: view.activeChangeId,
      }, {
        backToChanges: (context) => navigate({
          page: "changes",
          scopeId: context.scopeId,
          selectedChangeIds: context.selectedChangeIds,
        }),
        openSources: () => navigate({ page: "sources" }),
      });
      return;
    }
    if (view.page === "sources") {
      mountSources(content, undefined, {
        openSourceEditor: (sourceId, scopeId) => navigate({ page: "source-editor", sourceId, scopeId }),
        openTargetEditor: (targetId) => navigate({ page: "target-editor", targetId }),
      }, view.resourceId);
      return;
    }
    if (view.page === "source-editor") {
      mountSourceEditor(content, undefined, view.sourceId, view.scopeId, {
        backToSources: (resourceId) => navigate({ page: "sources", resourceId }),
      });
      return;
    }
    if (view.page === "target-editor") {
      mountTargetEditor(content, undefined, view.targetId, {
        backToSources: (resourceId) => navigate({ page: "sources", resourceId }),
      });
      return;
    }
    if (view.page === "history") {
      mountHistory(content);
      return;
    }
    content.innerHTML = `<section class="app-pending-view"><h1>此工作流将在后续步骤中提供。</h1></section>`;
  };
  const navigate = (next: AppView) => {
    viewState.navigate(next);
    renderCurrentView();
  };

  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest<HTMLButtonElement>("[data-action='github-login']")) {
      void refreshGithubAuthorization(githubAuthorization.state !== "ready");
      return;
    }
    const page = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]")?.dataset.page;
    if (page === "workbench" || page === "changes" || page === "sources" || page === "history") navigate({ page });
  });
  const refreshGithubAuthorization = async (startLogin = false) => {
    const requestGeneration = ++githubAuthorizationGeneration;
    githubAuthorizationLoading = startLogin;
    renderGithubAuthorization();
    try {
      const authorization = startLogin ? await startGithubLogin() : await githubAuthorizationStatus();
      if (requestGeneration !== githubAuthorizationGeneration) return;
      githubAuthorization = authorization;
    } catch {
      if (requestGeneration !== githubAuthorizationGeneration) return;
      githubAuthorization = { state: "unavailable", login: null };
    }
    githubAuthorizationLoading = false;
    renderGithubAuthorization();
  };
  renderCurrentView();
  void refreshGithubAuthorization();
}
