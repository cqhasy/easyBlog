import { mountChanges } from "../features/changes";
import { mountSources } from "../features/sources";
import { mountHistory } from "../features/history";
import { githubAuthorizationStatus, startGithubLogin } from "../bridge/targets";
import type { GithubAuthorization } from "../contracts";
import "../styles.css";

export function bootstrap(root: HTMLElement | null): void {
  if (!root) return;

  root.innerHTML = `<div class="app-shell"><aside class="app-nav" aria-label="主导航"><div class="app-brand" aria-label="easyBlog">easy<span>Blog</span></div><nav><button type="button" data-page="workbench">工作台</button><button type="button" data-page="sources">来源</button><button type="button" data-page="history">历史</button></nav><section class="github-authorization" aria-live="polite" data-github-authorization></section></aside><div class="app-content"><section data-page-panel="workbench"></section><section data-page-panel="sources" hidden></section><section data-page-panel="history" hidden></section></div></div>`;
  const workbench = root.querySelector<HTMLElement>('[data-page-panel="workbench"]');
  const sources = root.querySelector<HTMLElement>('[data-page-panel="sources"]');
  const history = root.querySelector<HTMLElement>('[data-page-panel="history"]');
  if (!workbench || !sources || !history) return;

  const changes = mountChanges(workbench);
  mountSources(sources, undefined, changes.refresh);
  mountHistory(history);
  const showPage = (page: "workbench" | "sources" | "history") => {
    workbench.hidden = page !== "workbench";
    sources.hidden = page !== "sources";
    history.hidden = page !== "history";
    root.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => {
      const active = button.dataset.page === page;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  };
  root.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest<HTMLButtonElement>("[data-action='github-login']")) {
      void refreshGithubAuthorization(githubAuthorization.state !== "ready");
      return;
    }
    const page = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]")?.dataset.page;
    if (page === "workbench" || page === "sources" || page === "history") showPage(page);
  });
  const authorizationPanel = root.querySelector<HTMLElement>("[data-github-authorization]");
  const renderGithubAuthorization = (authorization: GithubAuthorization, loading = false) => {
    if (!authorizationPanel) return;
    const detail = authorization.state === "ready"
      ? `已连接 @${authorization.login ?? "GitHub"}`
      : authorization.state === "missing_cli"
        ? "需要安装 GitHub CLI"
        : authorization.state === "unavailable"
          ? "暂时无法检查 GitHub"
          : "尚未连接 GitHub";
    const action = authorization.state === "ready"
      ? '<button type="button" data-action="github-login">重新检查</button>'
      : authorization.state === "missing_cli"
        ? '<a href="https://cli.github.com/" target="_blank" rel="noreferrer">安装 gh</a>'
        : `<button type="button" data-action="github-login" ${loading ? "disabled" : ""}>${loading ? "正在打开 GitHub..." : "连接 GitHub"}</button>`;
    authorizationPanel.innerHTML = `<strong>GitHub</strong><span>${detail}</span>${action}`;
  };
  let githubAuthorization: GithubAuthorization = { state: "unavailable", login: null };
  const refreshGithubAuthorization = async (startLogin = false) => {
    renderGithubAuthorization(githubAuthorization, startLogin);
    try {
      githubAuthorization = startLogin ? await startGithubLogin() : await githubAuthorizationStatus();
    } catch {
      githubAuthorization = { state: "unavailable", login: null };
    }
    renderGithubAuthorization(githubAuthorization);
  };
  void refreshGithubAuthorization();
  showPage("workbench");
}
