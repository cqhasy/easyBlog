import type { GithubAuthorization } from "../../contracts/models";

export function renderAccount(authorization: GithubAuthorization, authorizing: boolean): string {
  const login = authorization.state === "ready" && authorization.login
    ? `@${authorization.login}`
    : "尚未连接 GitHub";
  const buttonLabel = authorizing ? "正在重新授权..." : "重新授权 GitHub";

  return `<section class="account-page" aria-labelledby="account-title">
    <header>
      <p class="eyebrow">账户</p>
      <h1 id="account-title">GitHub 账户</h1>
    </header>
    <dl class="account-rows">
      <div><dt>GitHub 身份</dt><dd>${login}</dd></div>
    </dl>
    <button type="button" data-action="reauthorize"${authorizing ? " disabled" : ""}>${buttonLabel}</button>
  </section>`;
}
