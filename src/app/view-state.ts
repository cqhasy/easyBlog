export type ShellPage = "dashboard" | "history" | "sources" | "settings" | "account";
export type SidebarPreference = "expanded" | "collapsed";
export type SidebarMode = "expanded" | "collapsed";

export type AppView =
  | { page: ShellPage }
  | { page: "source-editor"; sourceId: string; scopeId?: string }
  | { page: "target-editor"; targetId: string };

export type ViewState = {
  current: () => AppView;
  navigate: (next: AppView) => void;
  setSidebarPreference: (next: SidebarPreference) => void;
  sidebarPreference: () => SidebarPreference;
};

export function resolveSidebarMode(
  preference: SidebarPreference,
  viewportWidth: number,
): SidebarMode {
  return viewportWidth <= 1000 ? "collapsed" : preference;
}

export function pageForNavigation(view: AppView): ShellPage {
  if (view.page === "source-editor" || view.page === "target-editor") {
    return "sources";
  }
  return view.page;
}

function cloneView(view: AppView): AppView {
  return { ...view };
}

export function createViewState(initial: AppView): ViewState {
  let currentView = cloneView(initial);
  let currentSidebarPreference: SidebarPreference = "expanded";

  return {
    current: () => cloneView(currentView),
    navigate: (next) => {
      currentView = cloneView(next);
    },
    setSidebarPreference: (next) => {
      currentSidebarPreference = next;
    },
    sidebarPreference: () => currentSidebarPreference,
  };
}
