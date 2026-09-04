# Home Shell and Mandatory GitHub Onboarding Design

**Status:** Proposed for review
**Date:** 2026-09-04
**Scope:** Desktop startup flow and authenticated application shell

## Goal

Make easyBlog feel like a calm desktop publishing utility from the moment it opens.

GitHub authorization is a required prerequisite, not an optional configuration step. Once authorization succeeds, users enter a compact application shell with a persistent left sidebar and an independent rounded workbench surface. The shell provides a stable home for the next product phase without prematurely designing the Dashboard's publishing or detection content.

## Scope

### In Scope

- Startup state detection and mandatory GitHub authorization.
- A recoverable authorization failure experience.
- An authenticated desktop shell with `Dashboard`, `History`, and `Sources`.
- A collapsible left sidebar with a compact icon-only B mode.
- Dedicated `Settings` and `Account` destinations in the sidebar footer.
- Migration of the existing History and Sources experiences into the new right-side workbench.
- A deliberately minimal, reachable Dashboard placeholder.
- A compact visual system modeled on shadcn-style utility layouts and the approved reference direction.

### Out of Scope

- Dashboard content design, including detection, change review, publishing, statistics, and dashboard widgets.
- Changes to GitHub auth provider behavior, bridge contract names, or backend persistence.
- Adding React, a router library, a component library, or a new persistence mechanism.
- Mobile-first layouts, theme switching, or a command palette.
- Reworking existing History or Sources business rules beyond the page boundary and shell integration.

## Relationship to the Existing Frontend Redesign Design

This document supersedes these parts of
`docs/superpowers/specs/2026-09-04-frontend-experience-redesign-design.md`:

- GitHub authorization is no longer deferred. It is mandatory at startup.
- The primary navigation becomes `Dashboard`, `History`, and `Sources`.
- `Changes` is not part of this shell phase and must not be represented as a primary destination.
- GitHub connection status and connection actions no longer occupy a shared display-area top bar.
- The outer shell uses a left sidebar and an independent rounded right workbench instead of a joined rail-and-content canvas.
- `Settings` and `Account` are secondary footer destinations, not first-level content entries.

All unrelated behavioral requirements from the earlier redesign remain applicable when those flows are implemented later.

## Startup and Authorization

### State Model

The application startup flow is represented by one explicit state machine:

```text
StartupState =
  | { kind: "checking" }
  | { kind: "authorization-required"; reason?: AuthorizationReason }
  | { kind: "authorizing" }
  | { kind: "ready"; account: GitHubAccountSummary }
  | { kind: "error"; error: StartupError };
```

`AuthorizationReason` differentiates unauthenticated, cancelled login, unavailable GitHub CLI, and authorization failure where the bridge can provide that distinction. Unknown authorization state is treated as authorization-required, never as ready.

### Startup Sequence

1. The app launches into `checking` and calls `githubAuthorizationStatus()`.
2. A confirmed authorized result moves to `ready` and opens `Dashboard`.
3. Any unauthenticated, missing, cancelled, failed, or unknown result moves to `authorization-required`.
4. The Welcome screen presents a single clear `Authorize GitHub` action.
5. Selecting it moves to `authorizing` and calls `startGithubLogin()`.
6. A successful login rechecks `githubAuthorizationStatus()` before entering `ready`.
7. A cancelled or failed login returns to `authorization-required` with concise recovery text. The user remains outside the application shell.
8. A non-auth startup error moves to `error`, which offers retry. If retry discovers that authorization is needed, it transitions to `authorization-required`.

If a later bridge operation reports that authorization has been lost, the app clears authenticated shell state and returns to `authorization-required`. Content pages must not remain reachable through stale in-memory navigation.

### Welcome Surface

The Welcome screen is intentionally spare:

- easyBlog icon and name;
- one sentence stating that GitHub authorization is required to use easyBlog;
- an `Authorize GitHub` primary action;
- concise status/error text when authorization is unavailable or retryable.

It is not a marketing page and does not expose dashboard, source, history, settings, or account navigation before authorization succeeds.

## Authenticated Application Shell

### Layout

The ready state renders two distinct regions:

```text
Outer canvas
├── Left sidebar
│   ├── Brand: app icon + "EasyBlog"
│   ├── Main navigation: Dashboard, History, Sources
│   └── Footer navigation: Settings, Account
└── Right workbench
    └── Active page content
```

The sidebar belongs directly to the outer canvas. The workbench is a separate interior component with its own subtle border and rounded corners. It must not visually fuse with the sidebar.

The page surface begins directly with its content. It must not show generic contextual labels such as `Dashboard` or `GitHub` in a persistent display-area top bar.

### Sidebar

The expanded sidebar is the default state:

- A restrained brand block at the upper left shows the app icon and `EasyBlog`.
- Every navigation item uses a recognizable small icon and a text label.
- The active destination has a quiet selected treatment; color is not the only active indicator.
- `Settings` and `Account` remain visually separated in the sidebar footer.
- A compact icon control lets the user toggle the sidebar mode.

### B Mode and Narrow Windows

B mode is the collapsed sidebar:

- The sidebar becomes a stable, narrow icon rail.
- Brand text and navigation labels are hidden.
- Each icon-only control has a tooltip and accessible name.
- The current destination remains obvious through shape, background, and accessible state.
- The toggle remains available to restore the expanded sidebar.

The shell automatically enters B mode when the desktop window cannot safely show the expanded sidebar and the workbench without compressing or overlapping controls. It returns to the user's preferred expanded mode when sufficient width is restored. A user-selected B mode remains collapsed until the user expands it.

This phase targets desktop and narrower desktop windows. It does not introduce a mobile navigation model.

## Page Ownership

### Dashboard

Dashboard is the first destination after authorization and remains reachable from the sidebar.

For this phase it is a minimal placeholder inside the workbench. It may show only a compact, neutral empty/coming-next state that preserves the shell's proportions. It must not invent dashboard metrics, cards, detection summaries, or publishing workflows. Dashboard content is the next design phase.

### History

History owns the existing publication-history experience. It renders inside the workbench and retains its current data-loading, item, and error behaviors unless a change is necessary to fit the shared shell.

History must not create a second app-level navigation system or persist an independent top status strip.

### Sources

Sources owns the existing source-related experience. It renders inside the workbench and retains existing source data and actions within its page boundary.

Future source/target editing refinements may be designed later. This phase is responsible only for making the existing experience legible and contained by the new shell.

### Settings

Settings is a secondary destination for application-level controls:

- application name and version;
- detection frequency;
- follow-system appearance preference;
- diagnostics entry points or summary.

Settings must not duplicate account identity or GitHub authorization actions.

### Account

Account is a secondary destination for GitHub identity and authorization:

- authenticated GitHub identity and connection status;
- reauthorization action;
- concise authorization error/recovery state where necessary.

Reauthorization follows the same `authorizing` and post-login status check rules as startup. Authorization loss returns the user to Welcome rather than leaving a partially usable shell.

## Visual System

The visual style follows the approved light, compact reference direction:

- light neutral outer canvas, near-white workbench surface, graphite text, fine gray borders;
- restrained blue-gray for focus, selection, and interactive emphasis;
- semantic green, amber, and red only for status meaning;
- small radii, with the independent workbench receiving the most visible rounding;
- small icon buttons for compact utility actions, sourced from the existing icon set;
- system sans-serif typography, compact desktop density, letter spacing `0`;
- no hero layouts, gradients, oversized welcome messaging, decorative backgrounds, or stacked floating cards.

Controls and text must retain stable dimensions at wide and narrow desktop widths. Icons used without visible labels require tooltips and accessible names.

## Module Boundaries

The existing imperative TypeScript DOM approach remains in place. The implementation introduces small state and rendering modules only where they clarify ownership:

```text
src/app/
  bootstrap.ts                 Bootstrap orchestration and startup-state rendering
  startup-state.ts             Startup/authentication transitions and helpers
  view-state.ts                Authenticated page selection and sidebar mode
  shell.ts                     Shared sidebar and workbench rendering

src/bridge/
  targets.ts                   Existing GitHub status/login bridge calls

src/features/
  dashboard/                   Minimal reachable placeholder
  history/                     Existing history page, adapted to the shell
  sources/                     Existing sources page, adapted to the shell
  settings/                    Application settings page
  account/                     GitHub identity and reauthorization page
```

Exact filenames may follow the local codebase's conventions, but startup state, authenticated navigation state, shell rendering, and page rendering must remain separate responsibilities.

No new backend API is required. `githubAuthorizationStatus()` and `startGithubLogin()` remain the auth boundary.

## Error Recovery

- Startup status check failure: show a concise retry action in the startup surface.
- Missing GitHub CLI or unavailable authorization capability: explain the prerequisite and retain retry after remediation.
- Login cancellation: remain on Welcome and make `Authorize GitHub` available again.
- Login failure: remain on Welcome, retain the action, and show a brief error.
- Runtime authorization loss: clear the shell and return to Welcome.
- Page-specific loading and error states: stay contained inside the workbench; never replace the entire shell unless authorization itself is invalid.

Asynchronous authorize and reauthorize commands disable duplicate submission while in flight and announce progress/results accessibly.

## Testing and Visual Verification

### Focused Tests

- `checking` transitions to Dashboard only after confirmed authorization.
- Unauthenticated, cancelled, failed, unavailable, and unknown auth states cannot enter the shell.
- Successful authorization rechecks status before entering Dashboard.
- Startup retry and authorization retry preserve the appropriate recovery state.
- Runtime authorization loss returns to Welcome and prevents stale page access.
- The expanded sidebar renders all main and footer destinations with icons.
- Sidebar B mode works from the toggle, renders accessible icon-only items, and restores labels when expanded.
- Narrow desktop widths auto-collapse safely without overlapping workbench content.
- Each main and footer destination changes the workbench page.
- Dashboard is reachable but contains no premature feature workflow.
- Settings and Account render their distinct responsibilities; Account invokes reauthorization through the shared startup/auth flow.

### Visual Checks

Capture screenshots at wide and narrow desktop widths for:

- Welcome, authorization-in-progress, and authorization failure;
- expanded and B-mode Dashboard shell;
- History, Sources, Settings, and Account workbench pages;
- an authorization-loss recovery state.

Inspect for clipped labels, icon ambiguity, text overlap, broken workbench rounding, excessive card density, and any generic page-top labels that contradict this design.

## Acceptance Criteria

The phase is complete when:

- easyBlog cannot enter the authenticated application without confirmed GitHub authorization;
- authorization success opens Dashboard, and loss of authorization returns to Welcome;
- the ready shell has `Dashboard`, `History`, and `Sources` in its main sidebar plus `Settings` and `Account` in its footer;
- all sidebar entries use icons, and the sidebar can operate as an accessible icon-only B-mode rail;
- the right-side workbench is an independent rounded component;
- the workbench contains no generic `Dashboard` or `GitHub` topbar labels;
- Dashboard is accessible but remains a restrained placeholder;
- History and Sources remain usable inside the new shell;
- Settings and Account have the responsibilities described above; and
- focused transition, rendering, accessibility, and wide/narrow visual checks cover the startup and shell states.
