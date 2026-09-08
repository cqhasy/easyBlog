# GitHub Authorization and Brand Correction Design

**Status:** Approved for implementation
**Date:** 2026-09-04
**Scope:** Mandatory GitHub onboarding, Tauri desktop login launch, and EasyBlog brand presentation

## Goal

Make mandatory GitHub authorization visible, recoverable, and truthful in the desktop app. A user who chooses to connect GitHub must be sent through GitHub CLI's browser authorization flow, receive clear in-app progress and recovery controls, and enter the authenticated shell only after a confirmed GitHub CLI status check.

The supplied EasyBlog mark is the canonical product mark for the desktop bundle, Welcome surface, and sidebar brand area.

## Decisions

### Authorization Launch

- `start_github_login` starts `gh auth login --hostname github.com --web --git-protocol https` as a child process and returns immediately after the process starts.
- The command no longer uses `--clipboard`; the requested behavior is a visible GitHub browser confirmation, not an opaque clipboard-assisted flow.
- Starting the child process is not treated as successful authorization. The only admission condition remains `gh auth status --hostname github.com`.
- A missing `gh` executable or failure to start the process returns a structured command error immediately.
- The app does not manufacture a `github.com/login` URL. GitHub CLI owns the authenticated device/browser flow and opens the correct browser confirmation page.

### Authorization Experience

- The Welcome surface is in Chinese and contains the supplied EasyBlog mark, product name, a concise mandatory-authorization explanation, and one primary `继续使用 GitHub` action.
- After the action starts the CLI, the UI shows a distinct browser-handoff state rather than an indefinite spinner:
  - state copy says that GitHub has opened in the default browser;
  - a `我已完成授权` control requests an immediate status check;
  - background checks run at a short bounded interval while the Welcome surface is visible;
  - returning focus to the app also requests a status check;
  - a retry action starts a fresh authorization launch if the user closes or cannot see the browser.
- A background check returning `ready` enters Dashboard. Any non-ready status preserves the unauthenticated Welcome surface.
- A failed launch or timeout gives concise recovery text and keeps the user outside the shell.
- Duplicate start requests are disabled while the launch request is in flight. The browser-handoff state remains actionable rather than disabled while the user completes GitHub's confirmation.

### Brand Assets and Shell

- Copy `codex-clipboard-32a0d7aa-d9fc-4b49-b25f-958e2a52e98b.png` into a versioned frontend asset path and use it with an `<img>` mark in Welcome and the sidebar.
- Generate desktop bundle icon variants from the same supplied source and configure Tauri's bundle icon list. The Windows executable, installer, taskbar/window presentation, and visible UI use the same mark.
- Remove the `EB` text mark entirely.
- Preserve the previously approved app shell: compact, independent rounded right workbench; main navigation of Dashboard, History, and Sources; Settings and Account in the footer; accessible B-mode icon rail.
- Do not place a `Dashboard` heading or a GitHub status strip above page content in the workbench.

## Components and Data Flow

```text
Welcome "Continue with GitHub"
  -> Tauri start_github_login
  -> spawn gh auth login --web
  -> immediate launch acknowledgement
  -> browser-handoff UI
  -> bounded status checks / "I have completed" / window focus
  -> Tauri github_authorization_status
  -> confirmed ready: render shell at Dashboard
```

- `backend/src/providers/github/auth.rs` owns process startup and command errors.
- `backend/src/actions/github_auth.rs` maps the provider result to app errors without claiming that launch equals authorization.
- `backend/src/commands/github.rs` preserves asynchronous Tauri execution and returns a launch acknowledgement.
- `src/app/startup-state.ts` distinguishes a launch-in-progress state from the browser-handoff state.
- `src/app/bootstrap.ts` owns timers, status checks, Welcome rendering, and cleanup.
- `src/app/shell.ts`, startup rendering, and `src/styles.css` own use of the frontend image asset.

## Error Handling

- If GitHub CLI is unavailable, show that it must be installed and retain a status-check retry.
- If the CLI cannot be started, show that browser authorization could not be opened and provide `再次打开 GitHub 授权`.
- If the browser handoff remains incomplete after a bounded period, retain the handoff UI and explain that authorization is still waiting; the user may confirm completion or relaunch.
- Status-check failures present a retryable network/capability message. They never render the shell.
- Login cancellation, closing the browser, or a nonzero CLI exit leave the app on Welcome.

## Testing and Verification

- Rust tests cover login command construction, specifically `--web`, no `--clipboard`, and nonblocking process launch behavior through an injectable command boundary.
- Frontend state tests cover launch, browser handoff, confirmed readiness, launch failure, and the no-shell authorization gate.
- Bootstrap tests cover the `我已完成授权` status check, focus revalidation, and timer cleanup when the shell becomes ready.
- Shell and bootstrap render tests assert the real EasyBlog image asset and absence of `EB`.
- Build the frontend, run Rust formatting and focused backend tests, then start `npm run tauri:dev`.
- On Windows, verify that a click opens a real GitHub CLI browser authorization page and that completing it moves the active desktop window to Dashboard.

## Acceptance Criteria

- A user can see and confirm GitHub authorization in a browser after selecting the Welcome action.
- The app never remains on an opaque English `Opening GitHub authorization...` screen.
- Authorization is mandatory and Dashboard appears only after `gh auth status` confirms readiness.
- The supplied EasyBlog icon is visible on Welcome and in the sidebar, replaces `EB`, and is configured as the Tauri bundle icon source.
- The previously approved compact shell and rounded workbench remain intact.
