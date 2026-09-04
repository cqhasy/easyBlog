import { describe, expect, it } from "vitest";
import { renderAppShell } from "./shell";

describe("app shell", () => {
  it("renders only Dashboard, History, and Sources as main navigation", () => {
    const html = renderAppShell({ page: "dashboard" }, "expanded");

    expect(html).toContain('data-page="dashboard"');
    expect(html).toContain('data-page="history"');
    expect(html).toContain('data-page="sources"');
    expect(html).not.toContain('data-page="changes"');
    expect(html).toContain('data-page="settings"');
    expect(html).toContain('data-page="account"');
  });

  it("renders a labeled icon rail in B mode", () => {
    const html = renderAppShell({ page: "history" }, "collapsed");

    expect(html).toContain('data-sidebar-mode="collapsed"');
    expect(html).toContain('aria-label="History" title="History"');
    expect(html).toContain('data-page="history" aria-current="page"');
    expect(html).not.toContain('class="app-topbar"');
  });

  it("keeps the right workbench independent from the sidebar", () => {
    const html = renderAppShell({ page: "sources" }, "expanded");

    expect(html).toMatch(
      /<aside class="app-sidebar"[^>]*>[\s\S]*<\/aside><main class="app-workbench"/,
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).not.toContain('class="app-topbar"');
    expect(html).not.toContain('class="github-status"');
    expect(html).not.toContain('class="github-action"');
    expect(html).not.toContain('data-github-status');
  });

  it("uses the same navigation markup for expanded and collapsed widths", () => {
    const expanded = renderAppShell({ page: "account" }, "expanded");
    const collapsed = renderAppShell({ page: "account" }, "collapsed");
    const navigationMarkup = (html: string) =>
      Array.from(html.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g), ([markup]) => markup);

    expect(expanded).toContain('data-sidebar-mode="expanded"');
    expect(collapsed).toContain('data-sidebar-mode="collapsed"');
    expect(navigationMarkup(expanded)).toHaveLength(2);
    expect(navigationMarkup(expanded)).toEqual(navigationMarkup(collapsed));
  });
});
