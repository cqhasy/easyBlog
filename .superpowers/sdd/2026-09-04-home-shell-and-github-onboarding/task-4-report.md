# Task 4 Report: Shell Destination Page Renderers

## Implementation

- Added `renderDashboard()` as a labeled placeholder section with `data-dashboard-placeholder`.
  It intentionally contains no detection, publishing, metrics, or card-grid workflow.
- Replaced the Settings marker export with `renderSettings()`, a labeled Chinese settings
  section containing descriptive rows for application version, manual checking, system
  appearance, and unavailable diagnostics. It has no form or persistence controls.
- Added `renderAccount(authorization, authorizing)`, a labeled Chinese account section that
  renders the ready GitHub login and a `data-action="reauthorize"` button. The button label and
  disabled attribute reflect the authorization-in-progress state.
- Added focused Vitest coverage for each renderer's required phase boundary.

## TDD RED

Added the following test files before implementation:

- `src/features/dashboard/index.test.ts`
- `src/features/settings/index.test.ts`
- `src/features/account/index.test.ts`

Ran:

```text
npm test -- src/features/dashboard/index.test.ts src/features/settings/index.test.ts src/features/account/index.test.ts
```

Result: failed as expected. Dashboard and Account renderer modules did not exist, and
`renderSettings` was not exported from the pre-existing marker-only Settings module.

## TDD GREEN

Implemented the minimal renderer modules, then reran:

```text
npm test -- src/features/dashboard/index.test.ts src/features/settings/index.test.ts src/features/account/index.test.ts
```

Result: passed. 3 test files and 3 tests passed.

## Commands And Results

```text
npm test -- src/features/dashboard/index.test.ts src/features/settings/index.test.ts src/features/account/index.test.ts
```

- RED: failed for missing renderer implementations.
- GREEN: passed, 3 test files and 3 tests.

```text
npm test
```

- Passed: 16 test files and 79 tests.

```text
git diff --check
```

- Passed: no whitespace errors.

```text
npm run build
```

- The pre-commit hook ran this command. It remains blocked by the intentionally stale
  `src/app/bootstrap.ts`, whose existing references to `workbench`, `changes`, and `review` no
  longer match the current view-state types. Task 5 owns that bootstrap replacement, so it was
  intentionally not changed here.

## Changed Files

- `src/features/dashboard/index.ts`
- `src/features/dashboard/index.test.ts`
- `src/features/settings/index.ts`
- `src/features/settings/index.test.ts`
- `src/features/account/index.ts`
- `src/features/account/index.test.ts`

## Self-Review

- Dashboard stays an inert placeholder and does not expose publishing or change-check actions.
- Settings reports only the capabilities available in this phase and contains no submit control.
- Account owns GitHub identity display and exposes one reauthorization action, disabled while
  authorization is pending.
- No backend APIs, persistence, bootstrap wiring, or unrelated files were changed.

## Concerns

- Task 5 is still responsible for wiring these pure renderers into the intentionally stale
  bootstrap. That integration was intentionally left untouched; its current type errors also
  prevent the pre-commit frontend build from passing until Task 5 lands.
