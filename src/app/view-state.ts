export type AppView =
  | { page: "workbench" }
  | { page: "changes"; scopeId?: string; selectedChangeIds?: string[] }
  | { page: "review"; scopeId: string; selectedChangeIds: string[]; activeChangeId: string }
  | { page: "sources"; resourceId?: string }
  | { page: "source-editor"; sourceId: string; scopeId?: string }
  | { page: "target-editor"; targetId: string }
  | { page: "history" };

export type ViewState = {
  current: () => AppView;
  navigate: (next: AppView) => void;
  openReview: (scopeId: string, selectedChangeIds: string[], activeChangeId: string) => void;
  backFromReview: () => void;
};

function cloneView(view: AppView): AppView {
  if (view.page === "changes") {
    return { ...view, selectedChangeIds: view.selectedChangeIds ? [...view.selectedChangeIds] : undefined };
  }
  if (view.page === "review") {
    return { ...view, selectedChangeIds: [...view.selectedChangeIds] };
  }
  return { ...view };
}

export function createViewState(initial: AppView): ViewState {
  let currentView = cloneView(initial);
  let reviewOrigin: Extract<AppView, { page: "changes" }> | undefined;

  return {
    current: () => cloneView(currentView),
    navigate: (next) => {
      currentView = cloneView(next);
    },
    openReview: (scopeId, selectedChangeIds, activeChangeId) => {
      reviewOrigin = { page: "changes", scopeId, selectedChangeIds: [...selectedChangeIds] };
      currentView = { page: "review", scopeId, selectedChangeIds: [...selectedChangeIds], activeChangeId };
    },
    backFromReview: () => {
      if (currentView.page !== "review") return;
      currentView = reviewOrigin
        ? { ...reviewOrigin, selectedChangeIds: reviewOrigin.selectedChangeIds ? [...reviewOrigin.selectedChangeIds] : undefined }
        : { page: "changes", scopeId: currentView.scopeId, selectedChangeIds: [...currentView.selectedChangeIds] };
    },
  };
}
