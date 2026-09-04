import { describe, expect, it } from "vitest";

import { renderAccount } from "./index";

describe("account", () => {
  it("renders the GitHub identity and disables duplicate reauthorization", () => {
    const html = renderAccount({ state: "ready", login: "octocat" }, true);

    expect(html).toContain("@octocat");
    expect(html).toContain('data-action="reauthorize" disabled');
  });

  it("escapes the GitHub login and enables reauthorization when idle", () => {
    const html = renderAccount({ state: "ready", login: '<img src=x onerror="alert(1)">' }, false);

    expect(html).toContain("@&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain('data-action="reauthorize">重新授权 GitHub</button>');
  });
});
