import { githubAuthorizationStatus, startGithubLogin } from "../bridge/targets";
import type { GithubAuthorization } from "../contracts";
import { renderAccount } from "../features/account";
import { renderDashboard } from "../features/dashboard";
import { mountHistory } from "../features/history";
import { renderSettings } from "../features/settings";
import { mountSources } from "../features/sources";
import { mountSourceEditor, mountTargetEditor } from "../features/sources/editor";
import { hydrateIcons } from "./icons";
import { reduceStartupState, type StartupState } from "./startup-state";
import { renderAppShell } from "./shell";
import {
  createViewState,
  resolveSidebarMode,
  type ShellPage,
} from "./view-state";
import "../styles.css";

export type AppDependencies = {
  githubAuthorizationStatus: typeof githubAuthorizationStatus;
  startGithubLogin: typeof startGithubLogin;
};

export type AppController = {
  start: () => Promise<void>;
  authorize: () => Promise<void>;
  confirmAuthorization: () => Promise<void>;
  revalidateAuthorization: () => Promise<void>;
  navigate: (page: ShellPage) => void;
  toggleSidebar: () => void;
  setViewportWidth: (viewportWidth: number) => void;
  dispose: () => void;
};

const browserAuthorizationPollIntervalMs = 2_000;
const maximumBrowserAuthorizationPolls = 60;
const startupBrand = '<div class="startup-brand"><img class="easyblog-mark" src="/easyblog-mark.png" alt="" /><span>EasyBlog</span></div>';

function renderStartupSurface(state: StartupState): string {
  if (state.kind === "checking") {
    return `<main class="startup-screen" data-startup-state="checking"><section>${startupBrand}<h1>正在检查 GitHub 授权</h1><p>EasyBlog 需要连接 GitHub 后才能继续使用。</p></section></main>`;
  }
  if (state.kind === "authorizing") {
    return `<main class="startup-screen" data-startup-state="authorizing"><section>${startupBrand}<h1>正在打开 GitHub 授权</h1><p>请稍候，EasyBlog 正在唤起默认浏览器。</p></section></main>`;
  }
  if (state.kind === "awaiting-browser-authorization") {
    return `<main class="startup-screen" data-startup-state="awaiting-browser-authorization"><section>${startupBrand}<h1>需要 GitHub 授权</h1><p>已在默认浏览器中打开 GitHub 授权。完成确认后回到这里。</p><div class="startup-actions"><button type="button" data-action="confirm-authorization">我已完成授权</button><button type="button" class="secondary-button" data-action="authorize-github">再次打开 GitHub 授权</button></div></section></main>`;
  }
  if (state.kind === "error") {
    return `<main class="startup-screen" data-startup-state="error"><section>${startupBrand}<h1>需要 GitHub 授权</h1><p>${state.message}</p><button type="button" data-action="retry-authorization">重新检查授权</button></section></main>`;
  }
  if (state.kind !== "authorization-required") return "";

  const message = state.message
    ?? (state.reason === "missing-cli"
      ? "请先安装 GitHub CLI 后再继续。"
      : state.reason === "unavailable"
        ? "GitHub 授权暂时不可用，请稍后重试。"
        : "EasyBlog 需要连接 GitHub 后才能继续使用。");
  return `<main class="startup-screen" data-startup-state="authorization-required"><section>${startupBrand}<h1>需要 GitHub 授权</h1><p>${message}</p><button type="button" data-action="authorize-github">继续使用 GitHub</button></section></main>`;
}

export function createAppController(
  root: HTMLElement,
  dependencies: AppDependencies,
  initialViewportWidth: number,
): AppController {
  const viewState = createViewState({ page: "dashboard" });
  let authorization: GithubAuthorization = { state: "unavailable", login: null };
  let startupState: StartupState = { kind: "checking" };
  let viewportWidth = initialViewportWidth;
  let authorizationGeneration = 0;
  let activeLoginGeneration: number | undefined;
  let sourcesResourceId: string | undefined;
  let pageGeneration = 0;
  let browserAuthorizationPoll: ReturnType<typeof setInterval> | undefined;
  let browserAuthorizationPolls = 0;
  let browserAuthorizationCheckInFlight = false;

  const renderCurrentPage = () => {
    const content = root.querySelector<HTMLElement>("[data-app-content]");
    if (!content) return;
    const view = viewState.current();
    const currentPageGeneration = ++pageGeneration;
    const isCurrentPage = () => currentPageGeneration === pageGeneration;
    if (view.page === "dashboard") {
      content.innerHTML = renderDashboard();
      return;
    }
    if (view.page === "history") {
      mountHistory(content);
      return;
    }
    if (view.page === "sources") {
      mountSources(content, undefined, {
        openSourceEditor: (sourceId, scopeId) => {
          if (!isCurrentPage()) return;
          sourcesResourceId = sourceId;
          viewState.navigate({ page: "source-editor", sourceId, scopeId });
          render();
        },
        openTargetEditor: (targetId) => {
          if (!isCurrentPage()) return;
          sourcesResourceId = targetId;
          viewState.navigate({ page: "target-editor", targetId });
          render();
        },
      }, sourcesResourceId, isCurrentPage);
      return;
    }
    if (view.page === "source-editor") {
      mountSourceEditor(content, undefined, view.sourceId, view.scopeId, {
        backToSources: (resourceId) => {
          if (!isCurrentPage()) return;
          sourcesResourceId = resourceId;
          viewState.navigate({ page: "sources" });
          render();
        },
      }, isCurrentPage);
      return;
    }
    if (view.page === "target-editor") {
      mountTargetEditor(content, undefined, view.targetId, {
        backToSources: (resourceId) => {
          if (!isCurrentPage()) return;
          sourcesResourceId = resourceId;
          viewState.navigate({ page: "sources" });
          render();
        },
      }, isCurrentPage);
      return;
    }
    if (view.page === "settings") {
      content.innerHTML = renderSettings();
      return;
    }
    content.innerHTML = renderAccount(authorization, startupState.kind === "authorizing");
  };

  const render = () => {
    if (startupState.kind !== "ready") {
      pageGeneration += 1;
      root.innerHTML = renderStartupSurface(startupState);
      return;
    }
    root.innerHTML = renderAppShell(
      viewState.current(),
      resolveSidebarMode(viewState.sidebarPreference(), viewportWidth),
    );
    hydrateIcons();
    renderCurrentPage();
  };

  const updateSidebarMode = () => {
    const shell = root.querySelector<HTMLElement>(".app-shell");
    const toggle = root.querySelector<HTMLElement>('[data-action="toggle-sidebar"]');
    if (!shell || !toggle) {
      render();
      return;
    }
    const sidebarMode = resolveSidebarMode(viewState.sidebarPreference(), viewportWidth);
    const expanded = sidebarMode === "expanded";
    shell.setAttribute("data-sidebar-mode", sidebarMode);
    toggle.setAttribute("aria-label", expanded ? "Collapse sidebar" : "Expand sidebar");
    toggle.setAttribute("title", expanded ? "Collapse sidebar" : "Expand sidebar");
    toggle.innerHTML = `<i data-lucide="${expanded ? "panel-left-close" : "panel-left-open"}"></i>`;
    hydrateIcons();
  };

  const clearBrowserAuthorizationPolling = () => {
    if (browserAuthorizationPoll !== undefined) {
      clearInterval(browserAuthorizationPoll);
      browserAuthorizationPoll = undefined;
    }
    browserAuthorizationPolls = 0;
  };

  const transition = (event: Parameters<typeof reduceStartupState>[1]) => {
    startupState = reduceStartupState(startupState, event);
    if (startupState.kind !== "awaiting-browser-authorization") {
      clearBrowserAuthorizationPolling();
    }
    render();
  };

  const checkAuthorization = async (
    generation: number,
    options: {
      preserveReadyShell?: boolean;
      preserveBrowserHandoff?: boolean;
      expireBrowserHandoff?: boolean;
    } = {},
  ): Promise<void> => {
    const keepReadyShell = options.preserveReadyShell && startupState.kind === "ready";
    const keepBrowserHandoff = options.preserveBrowserHandoff
      && startupState.kind === "awaiting-browser-authorization";
    if (!keepReadyShell && !keepBrowserHandoff) transition({ type: "begin-check" });
    try {
      const nextAuthorization = await dependencies.githubAuthorizationStatus();
      if (generation !== authorizationGeneration) return;
      authorization = nextAuthorization;
      if (keepReadyShell && authorization.state === "ready") {
        if (viewState.current().page === "account") renderCurrentPage();
        return;
      }
      if (keepBrowserHandoff && authorization.state !== "ready") {
        if (options.expireBrowserHandoff) {
          transition({ type: "authorization-expired" });
        }
        return;
      }
      transition({ type: "authorization-checked", authorization });
    } catch {
      if (generation !== authorizationGeneration) return;
      transition({
        type: "check-failed",
        message: "GitHub authorization could not be checked. Please retry.",
      });
    }
  };

  const checkBrowserAuthorization = async (
    generation: number,
    expireBrowserHandoff = false,
  ): Promise<void> => {
    if (
      browserAuthorizationCheckInFlight
      || generation !== authorizationGeneration
      || startupState.kind !== "awaiting-browser-authorization"
    ) {
      return;
    }
    browserAuthorizationCheckInFlight = true;
    try {
      await checkAuthorization(generation, {
        preserveBrowserHandoff: true,
        expireBrowserHandoff,
      });
    } finally {
      browserAuthorizationCheckInFlight = false;
    }
  };

  const startBrowserAuthorizationPolling = (generation: number) => {
    clearBrowserAuthorizationPolling();
    browserAuthorizationPoll = setInterval(() => {
      if (
        generation !== authorizationGeneration
        || startupState.kind !== "awaiting-browser-authorization"
      ) {
        clearBrowserAuthorizationPolling();
        return;
      }
      browserAuthorizationPolls += 1;
      void checkBrowserAuthorization(
        generation,
        browserAuthorizationPolls >= maximumBrowserAuthorizationPolls,
      );
    }, browserAuthorizationPollIntervalMs);
  };

  const controller: AppController = {
    start: async () => {
      transition({ type: "begin-check" });
      await controller.revalidateAuthorization();
    },
    authorize: async () => {
      if (activeLoginGeneration !== undefined) return;
      const generation = ++authorizationGeneration;
      activeLoginGeneration = generation;
      clearBrowserAuthorizationPolling();
      transition({ type: "begin-login" });
      try {
        await dependencies.startGithubLogin();
        if (generation !== authorizationGeneration) return;
        transition({ type: "login-started" });
        startBrowserAuthorizationPolling(generation);
      } catch {
        if (generation !== authorizationGeneration) return;
        transition({
          type: "login-failed",
          message: "无法打开 GitHub 授权，请重试。",
        });
      } finally {
        if (activeLoginGeneration === generation) {
          activeLoginGeneration = undefined;
        }
      }
    },
    confirmAuthorization: async () => {
      if (activeLoginGeneration !== undefined) return;
      if (startupState.kind !== "awaiting-browser-authorization") {
        await controller.revalidateAuthorization();
        return;
      }
      await checkBrowserAuthorization(authorizationGeneration);
    },
    revalidateAuthorization: async () => {
      if (activeLoginGeneration !== undefined) return;
      if (startupState.kind === "awaiting-browser-authorization") {
        await controller.confirmAuthorization();
        return;
      }
      const generation = ++authorizationGeneration;
      await checkAuthorization(generation, { preserveReadyShell: startupState.kind === "ready" });
    },
    navigate: (page) => {
      viewState.navigate({ page });
      render();
    },
    toggleSidebar: () => {
      viewState.setSidebarPreference(
        viewState.sidebarPreference() === "expanded" ? "collapsed" : "expanded",
      );
      if (startupState.kind === "ready") updateSidebarMode();
      else render();
    },
    setViewportWidth: (nextViewportWidth) => {
      viewportWidth = nextViewportWidth;
      if (startupState.kind === "ready") updateSidebarMode();
      else render();
    },
    dispose: () => {
      authorizationGeneration += 1;
      activeLoginGeneration = undefined;
      clearBrowserAuthorizationPolling();
      pageGeneration += 1;
    },
  };

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "toggle-sidebar") {
      controller.toggleSidebar();
      return;
    }
    if (action === "authorize-github" || action === "reauthorize") {
      void controller.authorize();
      return;
    }
    if (action === "confirm-authorization") {
      void controller.confirmAuthorization();
      return;
    }
    if (action === "retry-authorization") {
      void controller.revalidateAuthorization();
      return;
    }
    const page = target.closest<HTMLElement>("[data-page]")?.dataset.page;
    if (page === "dashboard" || page === "history" || page === "sources" || page === "settings" || page === "account") {
      controller.navigate(page);
    }
  });

  return controller;
}

export function bootstrap(root: HTMLElement | null): void {
  if (!root) return;

  const controller = createAppController(root, {
    githubAuthorizationStatus,
    startGithubLogin,
  }, window.innerWidth);
  window.addEventListener("focus", () => {
    void controller.revalidateAuthorization();
  });
  window.addEventListener("resize", () => {
    controller.setViewportWidth(window.innerWidth);
  });
  void controller.start();
}
