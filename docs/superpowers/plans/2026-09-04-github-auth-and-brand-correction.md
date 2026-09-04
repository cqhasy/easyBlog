# GitHub Authorization and Brand Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a visible GitHub browser authorization flow without blocking the Tauri UI, admit users only after confirmed authorization, and apply the supplied EasyBlog mark throughout the desktop product.

**Architecture:** The Rust provider starts `gh auth login --web` and immediately acknowledges that the browser handoff began; it does not wait for CLI completion or equate process launch with authorization. The TypeScript startup controller renders an explicit browser-handoff state, performs bounded confirmation checks, and mounts the existing shell only after `github_authorization_status` returns `ready`. A single source image feeds Vite's visible brand mark and generated Tauri bundle icons.

**Tech Stack:** Rust 2021, Tauri 2, TypeScript, Vite, Vitest, GitHub CLI, CSS.

**Spec:** `docs/superpowers/specs/2026-09-04-github-auth-and-brand-correction-design.md`

## Global Constraints

- Use `gh auth login --hostname github.com --web --git-protocol https`; do not use `--clipboard`.
- Process launch is never authorization success; only `gh auth status --hostname github.com` can admit the authenticated shell.
- Keep GitHub authorization mandatory before Dashboard, History, Sources, Settings, or Account can render.
- Keep the existing imperative TypeScript DOM architecture and current Tauri command names.
- Use `C:\Users\31819\AppData\Local\Temp\codex-clipboard-32a0d7aa-d9fc-4b49-b25f-958e2a52e98b.png` as the canonical mark for frontend and Tauri icon generation.
- Welcome and authorization copy must be Chinese. The shell must retain the agreed compact layout and independent rounded workbench.
- Do not add a GitHub status strip or generic Dashboard heading above workbench content.

---

### Task 1: Launch GitHub CLI Without Blocking the Desktop UI

**Files:**
- Modify: `backend/src/providers/github/auth.rs`
- Modify: `backend/src/actions/github_auth.rs`
- Modify: `backend/src/commands/github.rs`

**Interfaces:**
- Produces `GithubAuth::start_login() -> Result<(), GithubAuthError>`.
- Produces `actions::github_auth::GithubLoginLaunch { state: "started" }`.
- Changes `start_github_login` to return `AppResult<GithubLoginLaunch>`.
- Consumed by `src/bridge/targets.ts`.

- [ ] **Step 1: Write the failing provider and action tests**

Introduce a small `GithubCli` command boundary in `auth.rs`; its fake test implementation records the launch arguments and returns configured results. Add tests that prove a launch:

```rust
assert_eq!(
    fake.launches(),
    vec![vec![
        "auth", "login", "--hostname", "github.com",
        "--web", "--git-protocol", "https",
    ]]
);
assert!(!fake.launches()[0].contains(&"--clipboard".to_owned()));
```

Add an action test proving `start_login()` serializes to `GithubLoginLaunch { state: "started" }` without calling `GithubAuth::status()`.

- [ ] **Step 2: Run the focused backend test to verify it fails**

Run:

```powershell
cargo test --manifest-path backend/Cargo.toml providers::github::auth::tests actions::github_auth::tests
```

Expected: FAIL because `start_login`, `GithubLoginLaunch`, and the command boundary do not exist.

- [ ] **Step 3: Implement the nonblocking provider launch**

Keep existing status and credential setup behavior. Add the narrow command abstraction needed by provider tests and implement its production launch with:

```rust
Command::new("gh")
    .args([
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--web",
        "--git-protocol",
        "https",
    ])
    .spawn()
    .map(|_child| ())
```

Map `ErrorKind::NotFound` to `GithubAuthError::MissingCli`; map all other spawn errors to `GithubAuthError::LoginFailed`. Do not wait on the child and do not call `require_ready()` from launch.

Define:

```rust
#[derive(Debug, Serialize)]
pub struct GithubLoginLaunch {
    pub state: &'static str,
}
```

in `actions/github_auth.rs`. Its `start_login()` action returns `{ state: "started" }` after `GithubAuth::start_login()` succeeds. Update the Tauri command to run that short operation through `spawn_blocking`.

- [ ] **Step 4: Run the focused Rust tests and format**

Run:

```powershell
cargo fmt --manifest-path backend/Cargo.toml
cargo test --manifest-path backend/Cargo.toml providers::github::auth::tests actions::github_auth::tests
```

Expected: PASS and no Rust formatting diff.

- [ ] **Step 5: Commit the backend handoff**

```powershell
git add backend/src/providers/github/auth.rs backend/src/actions/github_auth.rs backend/src/commands/github.rs
git commit -m "fix: launch github authorization without blocking"
```

### Task 2: Model the Browser Handoff and Confirmed Authorization

**Files:**
- Modify: `src/contracts/models.ts`
- Modify: `src/bridge/targets.ts`
- Modify: `src/bridge/targets.test.ts`
- Modify: `src/app/startup-state.ts`
- Modify: `src/app/startup-state.test.ts`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/app/bootstrap.test.ts`

**Interfaces:**
- Produces `GithubLoginLaunch` in the bridge contract: `{ state: "started" }`.
- Adds startup state `{ kind: "awaiting-browser-authorization" }`.
- Adds `confirmAuthorization(): Promise<void>` and `dispose(): void` to `AppController`.
- `bootstrap()` registers focus and timer-driven checks through the controller.

- [ ] **Step 1: Write failing frontend tests**

Update bridge tests to assert the launcher is typed as a separate launch acknowledgement. Add state tests:

```ts
expect(reduceStartupState(
  { kind: "authorizing" },
  { type: "login-started" },
)).toEqual({ kind: "awaiting-browser-authorization" });

expect(reduceStartupState(
  { kind: "awaiting-browser-authorization" },
  { type: "authorization-checked", authorization: { state: "ready", login: "octocat" } },
)).toEqual({ kind: "ready", account: { login: "octocat" } });
```

Add bootstrap tests that prove:

```ts
await controller.authorize();
expect(root.innerHTML).toContain('data-startup-state="awaiting-browser-authorization"');
expect(root.innerHTML).toContain('data-action="confirm-authorization"');

await controller.confirmAuthorization();
expect(root.innerHTML).toContain('class="app-shell"');
```

Add one test using fake timers that verifies periodic checks stop after a confirmed `ready` result and `dispose()` clears pending timers.

- [ ] **Step 2: Run focused frontend tests to verify they fail**

Run:

```powershell
npm test -- src/app/startup-state.test.ts src/app/bootstrap.test.ts src/bridge/targets.test.ts
```

Expected: FAIL because the launch acknowledgement, browser-handoff state, confirmation action, and timer cleanup are absent.

- [ ] **Step 3: Implement the launch acknowledgement and controller state**

Add:

```ts
export interface GithubLoginLaunch {
  state: "started";
}
```

to `src/contracts/models.ts`, and change `startGithubLogin()` to `Promise<GithubLoginLaunch>`.

Add `awaiting-browser-authorization` and the `login-started` startup event. When a non-ready status arrives during this state, preserve the browser-handoff surface; when a `ready` status arrives, render the shell.

In `bootstrap.ts`:

- render Chinese Welcome content with primary `data-action="authorize-github"`;
- render `authorizing` only while the launch request is in flight;
- after launch acknowledgement, render `awaiting-browser-authorization` with `data-action="confirm-authorization"` and `data-action="authorize-github"` retry;
- schedule one authorization-status check every two seconds, capped after 60 attempts;
- when capped, stop polling and return to authorization-required with the message `GitHub 授权尚未完成，请在浏览器完成确认后重试。`;
- clear the interval and cap timer whenever state becomes ready, an explicit launch failure occurs, or `dispose()` runs;
- have `confirmAuthorization()` perform an immediate status check without replacing the browser-handoff surface until authorization is confirmed;
- make the existing focus listener call the same immediate check;
- preserve the existing no-duplicate-launch guard and all shell/editor preservation behavior.

Use concise copy:

```text
需要 GitHub 授权
EasyBlog 需要连接 GitHub 后才能继续使用。
继续使用 GitHub
已在默认浏览器中打开 GitHub 授权。完成确认后回到这里。
我已完成授权
再次打开 GitHub 授权
```

- [ ] **Step 4: Run focused frontend tests**

Run:

```powershell
npm test -- src/app/startup-state.test.ts src/app/bootstrap.test.ts src/bridge/targets.test.ts
```

Expected: PASS for browser handoff, manual confirmation, polling cleanup, login retry, and the existing authorization gate.

- [ ] **Step 5: Commit the frontend authorization flow**

```powershell
git add src/contracts/models.ts src/bridge/targets.ts src/bridge/targets.test.ts src/app/startup-state.ts src/app/startup-state.test.ts src/app/bootstrap.ts src/app/bootstrap.test.ts
git commit -m "fix: add visible github authorization handoff"
```

### Task 3: Apply the Supplied EasyBlog Mark to UI and Tauri

**Files:**
- Create: `public/easyblog-mark.png`
- Modify: `src/app/bootstrap.ts`
- Modify: `src/app/shell.ts`
- Modify: `src/app/shell.test.ts`
- Modify: `src/app/bootstrap.test.ts`
- Modify: `src/styles.css`
- Modify: `backend/tauri.conf.json`
- Modify: generated files under `backend/icons/`

**Interfaces:**
- UI markup uses `<img class="easyblog-mark" src="/easyblog-mark.png" alt="" />`.
- `backend/tauri.conf.json` lists generated icons in `bundle.icon`.
- Tests assert the image asset and reject the `EB` text mark.

- [ ] **Step 1: Write failing branding render tests**

Add shell and startup assertions:

```ts
expect(renderAppShell({ page: "dashboard" }, "expanded"))
  .toContain('<img class="easyblog-mark" src="/easyblog-mark.png" alt=""');
expect(renderAppShell({ page: "dashboard" }, "expanded"))
  .not.toContain(">EB<");
```

After an unauthenticated `controller.start()`, assert that Welcome contains the same mark and `EasyBlog`.

- [ ] **Step 2: Run the focused branding tests to verify they fail**

Run:

```powershell
npm test -- src/app/shell.test.ts src/app/bootstrap.test.ts
```

Expected: FAIL because the shell still renders the text `EB` mark and Welcome lacks the supplied image.

- [ ] **Step 3: Install the source mark and generate desktop icon variants**

Run:

```powershell
Copy-Item "C:\Users\31819\AppData\Local\Temp\codex-clipboard-32a0d7aa-d9fc-4b49-b25f-958e2a52e98b.png" public/easyblog-mark.png
npx tauri icon public/easyblog-mark.png --output backend/icons
```

Configure:

```json
"bundle": {
  "active": false,
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.ico"
  ]
}
```

Keep the product name and existing bundle state unchanged.

- [ ] **Step 4: Replace the text mark and refine the visual surface**

In the shell and Welcome renderer, replace all `EB` brand markup with the common image mark. In CSS:

- render the mark as a 28px square in expanded mode and 26px in B mode;
- give the mark a small 6px radius without a separate tinted text container;
- style Welcome as a calm centered panel with brand row, compact Chinese title, muted explanatory copy, and a single primary button;
- style browser-handoff actions as a primary `我已完成授权` control plus a quiet secondary relaunch control;
- retain the light neutral outer canvas, small controls, and 8px rounded independent workbench.

- [ ] **Step 5: Run frontend tests and build**

Run:

```powershell
npm test -- src/app/shell.test.ts src/app/bootstrap.test.ts
npm run build
```

Expected: PASS and Vite emits the public image into `dist/easyblog-mark.png`.

- [ ] **Step 6: Commit the product mark**

```powershell
git add public/easyblog-mark.png src/app/bootstrap.ts src/app/shell.ts src/app/shell.test.ts src/app/bootstrap.test.ts src/styles.css backend/tauri.conf.json backend/icons
git commit -m "style: apply easyblog brand mark"
```

### Task 4: Verify the Complete Desktop Handoff

**Files:**
- Modify only files required by verification failures from Tasks 1-3.

**Interfaces:**
- Verifies the completed `start_github_login` and status-check contract end to end.

- [ ] **Step 1: Run all automated checks**

Run:

```powershell
cargo fmt --manifest-path backend/Cargo.toml --check
cargo test --manifest-path backend/Cargo.toml
npm test
npm run build
```

Expected: all Rust and Vitest tests pass and the Vite production build completes.

- [ ] **Step 2: Start the Tauri app**

Run:

```powershell
npm run tauri:dev
```

Expected: the desktop `easyblog` window opens with the supplied application icon.

- [ ] **Step 3: Manually verify authorization and layouts**

In the running desktop app:

1. Confirm unauthenticated startup shows the supplied mark and `继续使用 GitHub`.
2. Click the action and confirm the default browser visibly opens GitHub CLI authorization.
3. Confirm the app changes to browser-handoff copy with `我已完成授权` and a relaunch control instead of an indefinite English spinner.
4. Complete GitHub authorization, return to the app, and confirm focus or `我已完成授权` enters Dashboard.
5. At 1280x900 inspect the expanded compact sidebar and independent rounded workbench.
6. At 960x900 confirm B mode has an icon-only rail with title tooltips and no text overlap.
7. Confirm no workbench-level GitHub strip or generic Dashboard heading is present.

- [ ] **Step 4: Commit any verification fix**

If verification requires a code correction, add its focused regression test first, run the affected test suite, then commit only the touched files:

```powershell
git add <verified-files>
git commit -m "fix: refine github authorization handoff"
```

## Plan Self-Review

### Spec Coverage

- Nonblocking GitHub CLI browser launch and no clipboard path: Task 1.
- Explicit browser handoff, bounded polling, manual confirmation, focus revalidation, and recovery: Task 2.
- Canonical product asset in visible UI and Tauri packaging: Task 3.
- Automated and Windows desktop end-to-end verification: Task 4.

### Placeholder Scan

The plan names every required file, command, state, action, copy string, and acceptance check. The final verification task permits edits only in response to a reproduced failure and requires a regression test first.

### Type Consistency

`GithubLoginLaunch`, `awaiting-browser-authorization`, `confirmAuthorization`, and `dispose` are introduced before their consuming tasks. The Tauri command name stays `start_github_login`, preserving the existing bridge endpoint.
