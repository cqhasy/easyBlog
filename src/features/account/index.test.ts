import { describe, expect, it } from "vitest";

import { renderAccount } from "./index";

describe("account", () => {
  it("renders the GitHub identity and disables duplicate reauthorization", () => {
    const html = renderAccount({ state: "ready", login: "octocat" }, true);

    expect(html).toContain("@octocat");
    expect(html).toContain('data-action="reauthorize" disabled');
  });
});
