import { describe, expect, it } from "vitest";

import { renderDashboard } from "./index";

describe("dashboard", () => {
  it("keeps Dashboard reachable without rendering a publishing workflow", () => {
    const html = renderDashboard();

    expect(html).toContain("data-dashboard-placeholder");
    expect(html).not.toContain("检查变更");
    expect(html).not.toContain("发布");
  });
});
