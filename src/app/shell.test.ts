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
});
