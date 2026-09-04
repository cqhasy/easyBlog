import { describe, expect, it } from "vitest";

import { renderSettings } from "./index";

describe("settings", () => {
  it("reports current settings capability without save controls", () => {
    const html = renderSettings();

    expect(html).toContain("手动检查");
    expect(html).toContain("跟随系统");
    expect(html).toContain("诊断暂不可用");
    expect(html).not.toContain('type="submit"');
  });
});
