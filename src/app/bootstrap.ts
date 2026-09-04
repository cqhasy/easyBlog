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
  revalidateAuthorization: () => Promise<void>;
  navigate: (page: ShellPage) => void;
  toggleSidebar: () => void;
  setViewportWidth: (viewportWidth: number) => void;
};

function renderStartupSurface(state: StartupState): string {
  if (state.kind === "checking") {
    return '<main class="startup-screen" data-startup-state="checking"><section><h1>Welcome</h1><p>Checking GitHub authorization...</p></section></main>';
  }
  if (state.kind === "authorizing") {
    return '<main class="startup-screen" data-startup-state="authorizing"><section><h1>Welcome</h1><p>Opening GitHub authorization...</p></section></main>';
  }
  if (state.kind === "error") {
    return `<main class="startup-screen" data-startup-state="error"><section><h1>Welcome</h1><p>${state.message}</p><button type="button" data-action="retry-authorization">Retry authorization check</button></section></main>`;
  }
  if (state.kind !== "authorization-required") return "";

  const message = state.message
    ?? (state.reason === "missing-cli"
      ? "GitHub CLI must be installed before you can continue."
      : state.reason === "unavailable"
        ? "GitHub authorization is temporarily unavailable."
        : "Connect GitHub to continue.");
  return `<main class="startup-screen" data-startup-state="authorization-required"><section><h1>Welcome</h1><p>${message}</p><button type="button" data-action="authorize-github">Authorize GitHub</button></section></main>`;
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

  const transition = (event: Parameters<typeof reduceStartupState>[1]) => {
    startupState = reduceStartupState(startupState, event);
    render();
  };

  const checkAuthorization = async (generation: number, preserveReadyShell = false): Promise<void> => {
    const keepReadyShell = preserveReadyShell && startupState.kind === "ready";
    if (!keepReadyShell) transition({ type: "begin-check" });
    try {
      const nextAuthorization = await dependencies.githubAuthorizationStatus();
      if (generation !== authorizationGeneration) return;
      authorization = nextAuthorization;
      if (keepReadyShell && authorization.state === "ready") {
        if (viewState.current().page === "account") renderCurrentPage();
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

  const controller: AppController = {
    start: async () => {
      transition({ type: "begin-check" });
      await controller.revalidateAuthorization();
    },
    authorize: async () => {
      const generation = ++authorizationGeneration;
      activeLoginGeneration = generation;
      transition({ type: "begin-login" });
      try {
        await dependencies.startGithubLogin();
        if (generation !== authorizationGeneration) return;
        await checkAuthorization(generation);
      } catch {
        if (generation !== authorizationGeneration) return;
        transition({
          type: "login-failed",
          message: "GitHub authorization was not completed. Please try again.",
        });
      } finally {
        if (activeLoginGeneration === generation) {
          activeLoginGeneration = undefined;
        }
      }
    },
    revalidateAuthorization: async () => {
      if (activeLoginGeneration !== undefined) return;
      const generation = ++authorizationGeneration;
      await checkAuthorization(generation, startupState.kind === "ready");
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
