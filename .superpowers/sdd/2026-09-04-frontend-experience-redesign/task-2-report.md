# Task 2 Report

Date: 2026-09-04

## Status

Completed.

## Commit

- `0e2eb1b feat: add focused change review workflow`

The report is intentionally not included in that commit because the required
commit command named only the six Task 2 source, test, bootstrap, and style
files.

## Changed Files

- `src/features/changes/index.ts`
- `src/features/changes/index.test.ts`
- `src/features/changes/review.ts`
- `src/features/changes/review.test.ts`
- `src/app/bootstrap.ts`
- `src/styles.css`

## Delivered Behavior

- Replaced the fixed list release drawer with a list-first selection workflow.
- Added selection reconciliation that removes stale and blocked IDs while
  preserving explicit deleted-item selections.
- Kept deleted changes opt-in even when a persisted record is selected.
- Added focused review with selected-only sequence navigation, summary,
  markdown metadata, persisted preview diffs, recovery states, and a native
  publish confirmation dialog.
- Wired review navigation through Task 1 view state and restored saved list
  selection on return.
- Kept `publishRelease` isolated to the review module and invoked it only with
  `plan.batch.id`.
- Removed fixed `.selection-bar` and `.release-panel` behavior and added a
  responsive review layout plus dialog backdrop styling.

## TDD Evidence

Observed red failures before their corresponding implementation changes:

- `reconcileSelectedChangeIds` was not exported, and `./review` did not exist.
- The legacy list test still expected the removed `Preview release` drawer
  control and was updated to assert the focused-review action.
- A preview-state render test did not include the persisted diff patch before
  the preview pane defaulted to the diff view.
- A deleted record marked `selected: true` was included by default before the
  opt-in deletion filter was added.

An initial TypeScript build also found fixture IDs inferred as `ChangeKind`;
the test helpers were corrected to declare string IDs explicitly.

## Verification

- Focused tests:
  `npm test -- src/features/changes/index.test.ts src/features/changes/review.test.ts`
  passed: 2 test files, 10 tests.
- Full suite:
  `npm test`
  passed: 10 test files, 42 tests.
- Production build:
  `npm run build`
  passed: TypeScript check and Vite build completed successfully.
- Whitespace:
  `git diff --check`
  completed with exit code 0 and no whitespace errors.
- Commit hook:
  `frontend-build` and `staged-whitespace` both passed during commit.

## Self-Review

- Checked that no fixed release drawer or fixed selection bar remains.
- Checked that blocked entries render visibly but cannot be selected or opened
  for review.
- Checked that review selection order follows the incoming context after
  missing and blocked entries are filtered.
- Checked that the confirm control carries only the persisted batch ID and
  contains no change ID payload.
- Checked that the list route passes saved scope and selection context back
  into `mountChanges`.

## Concerns

- No blocking concerns.
- Coverage is render and state-helper focused. The current Vitest environment
  does not provide a browser DOM harness, so direct click-to-dialog interaction
  is covered through the controller's guarded implementation and compile/full
  suite rather than a DOM integration test.

## Fix Round 1

### Status

Completed.

### Findings Addressed

- Preserved the explicit `Set` insertion order when passing selected change IDs
  into review, while still excluding missing and blocked changes.
- Applied the blue-gray review interaction accent to `进入评审`, `预览发布`,
  and both `确认发布` controls instead of allowing the legacy green global
  button treatment to apply.
- Localized review-facing change and file-diff kind labels into Chinese.

### Changed Files

- `src/features/changes/index.ts`
- `src/features/changes/index.test.ts`
- `src/features/changes/review.ts`
- `src/features/changes/review.test.ts`
- `src/styles.css`

### TDD Failures Observed

The new focused regression tests were run before the implementation update:

- `opens review in the explicit selected order rather than backend list order`
  expected `selectedChangeIds: ["b", "a"]` and `activeChangeId: "b"`, but
  received backend order `["a", "b"]` and active ID `"a"`.
- `localizes change kinds in the review sequence and summary` expected
  `新增`, but the review HTML still rendered the raw `added` enum value.

### Exact Commands and Results

- `npm test -- src/features/changes/index.test.ts src/features/changes/review.test.ts`
  before the fix: exit code 1; 2 test files failed, with 2 failures and 10
  passing tests.
- `npm test -- src/features/changes/index.test.ts src/features/changes/review.test.ts`
  after the fix: exit code 0; 2 test files and 12 tests passed.
- `npm run build`: exit code 0; TypeScript check and Vite production build
  passed.
- `git diff --check`: exit code 0; no whitespace errors.
- Commit hooks: `backend-format`, `frontend-build`, and `staged-whitespace`
  all passed.

### Commit

- `6265fa8 fix: preserve review selection order`

### Self-Review

- Verified that list-to-review navigation resolves selected IDs in selection
  order, not backend list order.
- Verified that blocked and missing IDs remain excluded from review.
- Verified that the review action controls explicitly use the blue-gray accent
  class while success green remains untouched.
- Verified that user-facing change and file-diff kind labels no longer expose
  raw enum text.

### Concerns

- No blocking concerns.
