import {
  pageForNavigation,
  type AppView,
  type ShellPage,
  type SidebarMode,
} from "./view-state";

type NavigationItem = {
  page: ShellPage;
  label: string;
  icon: string;
};

const mainNavigation: NavigationItem[] = [
  { page: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { page: "history", label: "History", icon: "history" },
  { page: "sources", label: "Sources", icon: "folder-tree" },
];

const footerNavigation: NavigationItem[] = [
  { page: "settings", label: "Settings", icon: "settings" },
  { page: "account", label: "Account", icon: "circle-user-round" },
];

function renderNavigationItem(item: NavigationItem, activePage: ShellPage): string {
  const active = item.page === activePage ? ' aria-current="page"' : "";
  return `<button type="button" class="app-nav-button" data-page="${item.page}"${active} aria-label="${item.label}" title="${item.label}"><i data-lucide="${item.icon}"></i><span class="app-nav-label">${item.label}</span></button>`;
}

export function renderAppShell(view: AppView, sidebarMode: SidebarMode): string {
  const activePage = pageForNavigation(view);
  const toggleIcon = sidebarMode === "expanded" ? "panel-left-close" : "panel-left-open";
  const toggleLabel = sidebarMode === "expanded" ? "Collapse sidebar" : "Expand sidebar";

  return `<div class="app-shell" data-sidebar-mode="${sidebarMode}"><aside class="app-sidebar" aria-label="EasyBlog navigation"><div class="app-brand"><img class="easyblog-mark" src="/easyblog-mark.png" alt="" /><span class="app-brand-name">EasyBlog</span><button type="button" class="app-sidebar-toggle" data-action="toggle-sidebar" aria-label="${toggleLabel}" title="${toggleLabel}"><i data-lucide="${toggleIcon}"></i></button></div><nav class="app-primary-navigation" aria-label="Main navigation">${mainNavigation.map((item) => renderNavigationItem(item, activePage)).join("")}</nav><nav class="app-footer-navigation" aria-label="Account navigation">${footerNavigation.map((item) => renderNavigationItem(item, activePage)).join("")}</nav></aside><main class="app-workbench" data-app-content aria-label="Application content"></main></div>`;
}
