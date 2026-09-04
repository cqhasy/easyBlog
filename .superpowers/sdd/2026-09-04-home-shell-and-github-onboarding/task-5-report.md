# Task 5 Report: Mandatory GitHub Authorization Bootstrap

Date: 2026-09-04

## Implementation

- Replaced the legacy bootstrap coordinator with `createAppController(root, dependencies, viewportWidth)` and production `bootstrap(root)`.
- Added reducer-backed startup rendering. `checking`, `authorizing`, `authorization-required`, and `error` render only a Welcome/startup surface; only confirmed `ready` renders the application shell.
- Made login admission mandatory: `authorize()` invokes `startGithubLogin()` and then performs a fresh `githubAuthorizationStatus()` check. The login command result is ignored for shell admission.
- Added status-check error retry, login-failure recovery text, and revalidation that removes an already-mounted shell when status later becomes non-ready.
- Mounted the Task 3 shell and hydrated Lucide icons only for ready state. Dashboard, History, Sources, source editor, target editor, Settings, and Account are mounted through the new view-state routes.
- Preserved Sources editor return navigation with bootstrap-local selected resource state because the Task 2 `AppView` contract deliberately does not carry a resource id.
- Added production `focus` revalidation and viewport-width updates on `resize`.
- Routed root clicks for pages, sidebar toggle, GitHub authorization, Account reauthorization, and authorization retry through controller methods.
- Removed bootstrap imports and navigation exposure for Workbench, Changes, and Review. Their modules and tests remain unchanged.
- Kept the bridge API unchanged. The existing test continues to assert the exact `github_authorization_status` and `start_github_login` Tauri commands.

## TDD

### RED

Created `src/app/bootstrap.test.ts` before implementing the controller, covering:

- authorization-required Welcome without an app shell;
- login followed by a required fresh status check;
- loss of a previously ready shell after revalidation;
- status-check rejection and retry;
- login rejection;
- Account reauthorization;
- sidebar toggle and 960-pixel compact mode.

Command:

```text
npm test -- src/app/bootstrap.test.ts
```

Result: failed as expected. All seven tests reported `TypeError: createAppController is not a function`, because the legacy bootstrap did not export the requested controller or provide mandatory startup rendering.

### GREEN

Implemented the controller and reran:

```text
npm test -- src/app/bootstrap.test.ts
```

Result: passed, with 1 test file and 7 tests passing.

## Verification

```text
npm test -- src/app/bootstrap.test.ts src/bridge/targets.test.ts
```

Result: passed, with 2 test files and 11 tests passing.

```text
npm test
```

Result: passed, with 17 test files and 87 tests passing.

```text
npm run build
```

Result: passed. TypeScript completed and Vite built production assets successfully. Vite emitted its advisory that the generated JavaScript chunk is larger than 500 kB after minification.

```text
git diff --check
```

Result: passed with no whitespace errors.

## Files Changed

- `src/app/bootstrap.ts`
- `src/app/bootstrap.test.ts`
- `src/bridge/targets.test.ts`
- `.superpowers/sdd/2026-09-04-home-shell-and-github-onboarding/task-5-report.md`

## Self-Review

- Only a fresh `githubAuthorizationStatus()` result with `state: "ready"` can render the shell.
- Non-ready startup states replace the root with a Welcome/error surface, preventing a stale authenticated shell.
- Login results are never trusted as authorization admission.
- Focus revalidates authorization, resize updates controller viewport width, and root clicks route through the controller.
- Dashboard, History, Sources/editor routes, Settings, and Account use the Task 2-4 contracts.
- Bootstrap no longer imports or exposes Workbench, Changes, or Review.
- The backend command surface remains exactly `githubAuthorizationStatus` and `startGithubLogin`.

## Concerns

- Vite reports the existing production JavaScript chunk-size advisory (>500 kB after minification); it does not fail the build.
- The pre-existing untracked `docs/superpowers/plans/2026-09-04-home-shell-and-github-onboarding.md` was not changed.
