import { mountChanges } from "../features/changes";
import { mountSources } from "../features/sources";
import { mountHistory } from "../features/history";
import "../styles.css";

export function bootstrap(root: HTMLElement | null): void {
  if (!root) return;

  root.innerHTML = `<div class="app-shell"><aside class="app-nav" aria-label="主导航"><div class="app-brand" aria-label="easyBlog">easy<span>Blog</span></div><nav><button type="button" data-page="workbench">工作台</button><button type="button" data-page="sources">来源</button><button type="button" data-page="history">历史</button></nav></aside><div class="app-content"><section data-page-panel="workbench"></section><section data-page-panel="sources" hidden></section><section data-page-panel="history" hidden></section></div></div>`;
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
    const page = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-page]")?.dataset.page;
    if (page === "workbench" || page === "sources" || page === "history") showPage(page);
  });
  showPage("workbench");
}
