# Publication State, Ownership, and Rollback Design

**Goal:** Replace the current scope-wide snapshot rollback model with a target-scoped publication ledger. The ledger must preserve source-to-target ownership, make previewed output immutable, support batches containing multiple articles and resources, and block unsafe publish, retry, and rollback operations before they overwrite uncertain target state.

## Scope and Product Decisions

This design implements the PRD requirements that each target article has exactly one source binding, that target-side external changes block affected publication, that release batches can be split, and that history supports retry and reverse rollback commits without rewriting remote history.

The user-confirmed rollback semantic is:

> A rollback reverses only the files and binding transitions owned by that publication. It preserves later independent publications. If later publication or external work changed an affected file, rollback stops with a conflict instead of restoring a whole Scope.

The system remains one-way from source to GitHub. SQLite stores metadata only: IDs, paths, kinds, hashes, revisions, Git commit SHAs, timestamps, and diagnostic codes. It must not store article Markdown bodies, resource bytes, credentials, tokens, or secrets.

This change is intentionally limited to local publication state, target ownership, and recovery. It does not add GitHub-to-source synchronization, source merging, collaboration, a remote service, or a general Git conflict resolver. All `content_hash` values in this design are SHA-256 digests of the exact target file bytes. Git blob identifiers are recorded separately because a repository may use a different Git object format.

## Why the Current Model Is Insufficient

The current implementation derives target paths from the currently observed article title and resource file name. It stores source snapshots per Scope and a flat list of change IDs per publication. Preview and publish independently rebuild a file set from live source files. A provisional rollback restores the complete Scope snapshot that existed before publication.

That model is incorrect in the following cases:

- A title or slug rename cannot identify the previously published article path to delete.
- A resource rename or removal cannot identify obsolete target resource files.
- The same target path can be owned by a different source outside the selected batch.
- A preview can differ from the later confirmation because source files changed in between.
- A retry cannot prove that a pending commit still represents the selected changes after another scan.
- Restoring a whole Scope snapshot can erase baselines or pending work from later independent batches.
- Git fast-forward alone cannot detect a remote edit to a target file owned by easyBlog.
- A target layout change silently changes derived paths and leaves old files orphaned.

The existing `snapshots_before_publish` publication field is therefore transitional only. It must not be the long-term recovery mechanism.

## Core Model and Invariants

### Source Snapshot

`SourceSnapshot` represents the latest source version accepted by a published binding revision. Its key remains `(scope_id, source_identity)`. It contains source identity, source path, title metadata, source fingerprint, and observation time. It answers only: "which source version is reflected in the currently accepted target binding?"

It does not describe a target file path, target file content, a release plan, or a rollback baseline.

### Article Binding

`ArticleBinding` is the durable mapping between a stable source article identity and a logical target article.

Required fields:

```text
binding_id
target_id
scope_id
source_identity
state: active | deleted | needs_reconciliation | recovery_required
current_revision
created_at
updated_at
```

Constraints:

- `(target_id, source_identity)` is unique. A source article has one binding in one target.
- `(target_id, canonical_article_path)` is unique among active binding revisions. Two source articles cannot own the same target article path.
- A deleted article keeps its binding and last accepted revision until the deletion publication is successfully committed and pushed. This makes deletion and rollback auditable.
- A source path move does not create a new binding when source identity is unchanged.

`scope_id` is recorded for diagnostics and source baseline coordination. Target ownership is governed by `target_id`, not by Scope; multiple Scopes may share one target only when their bindings and outputs do not overlap.

### Binding Revision and Outputs

Each accepted state of a binding is immutable as a `BindingRevision`:

```text
binding_revision_id
binding_id
revision_number
source_fingerprint
source_path
article_path
adapter
layout_fingerprint
state: active | deleted
accepted_publication_id
created_at
```

`BindingOutput` rows belong to a binding revision. Each row represents one target file currently owned by that revision:

```text
binding_revision_id
target_path
output_kind: article | resource
content_hash
git_blob_sha nullable
```

The article Markdown and every generated resource file have their own output row. Paths are normalized repository-relative paths and must pass the existing target layout/path safety rules.

The database stores hashes and path metadata, not file contents. The accepted Git commit remains the durable source of published content.

### Target Revision

`TargetRevision` serializes target mutations:

```text
target_id
sequence
head_commit_sha
state: ready | operation_in_progress | recovery_required
updated_at
```

Only one operation that writes, commits, pushes, or reverses commits may be active for a target. Different targets may operate independently. The target sequence and head SHA protect against batches that were planned against an older remote state.

### Release Batch and Immutable Operations

`ReleaseBatch` becomes a durable record rather than a transient preview object:

```text
batch_id
scope_id
target_id
scope_revision
target_sequence_before
target_head_before
state
created_at
previewed_at nullable
commit_sha nullable
published_at nullable
rollback_commit_sha nullable
rolled_back_at nullable
failure_code nullable
```

`ReleaseOperation` is an immutable per-file ledger entry created during preview:

```text
operation_id
batch_id
ordinal
binding_id
binding_revision_before nullable
binding_revision_after nullable
operation_kind: write | delete
target_path
before_hash nullable
after_hash nullable
before_blob_sha nullable
after_blob_sha nullable
```

The operation list is the sole source for preview diffs, staging, retry validation, history detail, and inverse rollback. It contains all target file transitions, including deletes created by slug changes, resource removals, and target configuration migration.

An operation with `before_hash = null` requires the path to be absent. An operation with `after_hash = null` is a deletion. Existing non-easyBlog files may be used as `before_hash` only after explicit conflict handling; v1 blocks a write to an unowned existing file rather than adopting it implicitly. A delete operation must have a non-null `before_blob_sha`, so its inverse can restore the exact prior Git object without storing file content in SQLite.

## Release States and Allowed Transitions

```text
draft
  -> previewed
  -> committing
  -> pending_push
  -> published
  -> rollback_prepared
  -> rollback_pending
  -> rolled_back

draft | previewed -> invalidated
committing | pending_push | rollback_prepared | rollback_pending -> recovery_required
```

- `draft`: batch metadata may exist while planning; it has no user-visible confirmation yet.
- `previewed`: the operation ledger and preconditions are frozen. The UI shows diffs from this ledger.
- `committing`: a protected target workspace is being staged and committed. This state is persisted before invoking Git.
- `pending_push`: the publish commit exists locally and the database records its SHA, but remote push is not confirmed.
- `published`: push succeeded and binding/source baseline transitions were committed locally.
- `rollback_prepared`: inverse operations passed validation and the revert commit is being created.
- `rollback_pending`: the reverse commit exists locally but its push is not confirmed.
- `rolled_back`: reverse commit pushed and the inverse binding/source baseline transitions were applied.
- `invalidated`: preview inputs changed before a commit was created. The user must create a new preview.
- `recovery_required`: the system cannot prove correspondence between Git and its ledger. No automatic write or cleanup is allowed.

State changes and target sequence updates are performed in SQLite transactions. Git cannot participate in a SQLite transaction, so each state transition is recorded before the irreversible Git boundary and reconciled after restart.

## Scan and Change Detection

Scanning reads accepted source snapshots and active binding revisions. It never modifies a binding, a binding output, a target revision, or a publication record.

For each source identity:

- No accepted binding and present source content produces `added`.
- An active binding with a different source fingerprint produces `updated`.
- The same identity with a changed source path produces `moved`; target paths are unchanged unless a later release plan intentionally changes them.
- An active binding absent from the scan produces `deleted`; its existing binding output list supplies all target delete operations after explicit selection.
- A source normalization failure, ambiguous identity, overlapping source ownership, or unreconcilable binding produces `blocked` and preserves the last accepted state.

Pending changes are a replaceable view of current source observations. They are not a release record and must never be used as the durable recovery authority for a previously created commit.

## Preview Planning

Preview is a transactional planning operation:

1. Read the selected pending changes, Scope revision, target configuration, target sequence, and target head after acquiring and synchronizing the managed checkout.
2. Validate that the target is ready and has no active target mutation or recovery requirement.
3. Normalize and render selected live source files once. Compute their source fingerprints and target output hashes.
4. Load every affected binding revision and produce a complete before/after output set per binding.
5. Diff output sets. A renamed slug produces deletes for all prior outputs no longer present and writes for all new outputs. Resource additions, removals, and renames use the same set-difference rule.
6. Validate output ownership globally for the target, not just inside the selected list. Block duplicate article paths, duplicate resource paths, paths owned by another binding, and writes over unowned existing target files.
7. Read each affected target file and verify it matches its expected binding output hash or declared absence. A mismatch is `target_external_change` and blocks the affected batch.
8. Persist the immutable batch, binding revisions proposed by the batch, operation ledger, source fingerprints, Scope revision, target sequence, and target head in one transaction. Mark the batch `previewed`.
9. Build UI diff text from the frozen operation list. Text bodies are read from the source/workspace only for presentation and are not saved in SQLite.

The backend publish command receives `batch_id`, not a fresh list of `scope_id` and `change_ids`. The UI cannot confirm a different selection than the one it previewed.

## Publish and Retry

### Publish

To publish a `previewed` batch:

1. Acquire the target operation lock and reload the target workspace.
2. Verify the Scope revision, target configuration fingerprint, target sequence, and remote head equal the frozen preconditions.
3. Re-read every affected source file that remains present and require its fingerprint and regenerated output hash to equal the operation ledger. For a selected deletion, require the source identity to remain absent. This keeps SQLite free of bodies while preventing a stale preview from publishing changed source content.
4. Re-read every affected target file and require its hash to equal `before_hash`. Any mismatch invalidates the batch or raises a target conflict before staging.
5. Mark `committing`, apply exactly the frozen operations, create a commit, record `commit_sha`, and mark `pending_push` before push.
6. Push the recorded commit. On success, in one local transaction: advance the target sequence/head, activate binding revisions, replace accepted source snapshots for affected bindings, clear only matching pending changes, and mark `published`.

The transition after push must be idempotent so application crash recovery can complete it once the remote commit is proven present.

### Retry

Retry applies only to `pending_push` or `rollback_pending` batches. It never rerenders source content or recomputes a file set.

For a pending publish, the application verifies that the managed checkout contains the recorded commit and that it is the expected ahead commit for the target. It then pushes that exact commit. If push succeeds, it finalizes the already-recorded binding and snapshot transitions.

If the commit cannot be found, the checkout is not the expected Git state, the remote contains an ambiguous equivalent state, or local metadata cannot be reconciled, transition to `recovery_required`. Do not create a replacement commit automatically.

## Rollback

Rollback is a new reverse Git commit; it never uses reset, force push, or history rewrite.

To roll back a `published` batch:

1. Acquire the target operation lock and require the batch target to be ready.
2. For every original operation, validate the current target file hash against the original `after_hash`. A deleted original operation requires the path to remain absent. If any path differs, report all conflicting paths and stop before creating a commit.
3. Confirm target sequence ordering. A later batch that did not touch the same output is permitted. A later batch that touched an output is already caught by the hash check. Target-wide serialization ensures the check and commit are not raced.
4. Generate inverse operations in reverse ordinal order: original writes restore the `before_blob_sha` object or delete newly created paths; original deletes restore their required `before_blob_sha` object. Read those objects from the recorded pre-publication Git commit and verify their SHA-256 hashes before staging.
5. Create a reverse Git commit, persist its SHA as `rollback_pending`, then push it.
6. After a successful push, move each affected binding from its after revision back to its before revision, restore only the affected source snapshot baselines, and mark the batch `rolled_back`.

The system must not restore an entire Scope snapshot. It must not clear unrelated pending changes. After rollback, a scan should show only the source identities whose accepted source baseline was reversed as pending; unrelated published content remains accepted.

Rollback of a publication with a missing or legacy operation ledger is `recovery_required`, not a scope-wide reset. The history UI should show a clear message that the old record cannot be safely reversed by the new model.

## External Changes and Target Configuration Migration

An external change is any target file mismatch against an expected binding output hash after the managed workspace has synchronized to remote. Unrelated remote commits are allowed. A remote change to an owned file blocks only the affected operation; it does not make the entire target unusable unless recovery state is uncertain.

Changing adapter, posts directory, or resources directory changes the target configuration fingerprint. Existing active bindings become `needs_reconciliation` and cannot publish ordinary source updates.

The reconciliation flow creates a dedicated migration batch:

- It renders each affected binding under the new configuration.
- It lists all old owned output paths to delete and all new output paths to write.
- It applies the same global ownership and target hash checks as a normal release.
- It is a normal immutable publication with a normal reverse rollback path.

Saving target configuration alone does not write, move, or delete target files.

## Persistence and Migration

Introduce these relational tables:

```text
article_bindings
binding_revisions
binding_outputs
target_revisions
release_batches
release_operations
release_binding_transitions
release_source_transitions
release_conflicts
```

Foreign keys must preserve audit records. Bindings and revisions are not physically deleted when a source article is deleted or a batch is rolled back. Index target-wide ownership and operation lookups:

```text
UNIQUE(target_id, source_identity)
UNIQUE(target_id, article_path) for active revisions
UNIQUE(target_id, target_path) for active outputs
INDEX(release_operations.batch_id, ordinal)
INDEX(release_operations.target_path)
INDEX(release_batches.target_id, state, created_at)
```

Migration rules:

- Existing source snapshots and pending changes remain readable for scanning.
- Existing publication rows remain visible in history.
- Existing `snapshots_before_publish` is retained only for backward compatibility while old code paths are removed; it is never used to execute a new rollback.
- Existing publications lack reliable per-file ownership and are displayed as legacy. They are not eligible for automatic rollback after this migration.
- Existing targets with published content require a one-time ownership adoption/reconciliation flow before newly discovered content can claim an existing target path. There is no silent inference from titles or directory names.

The migration must be additive and transactional. If database upgrade cannot complete, the application enters a storage recovery state and does not run publishing actions.

## API and UI Contracts

Backend contracts change as follows:

- `preview_release(scope_id, change_ids)` returns a persisted batch ID and immutable diff summary.
- `publish_release(batch_id)` confirms the exact previewed batch.
- `retry_release(batch_id)` pushes only an existing recorded commit.
- `rollback_publication(batch_id)` returns either a rollback commit SHA or structured conflict/recovery diagnostics.
- History records expose state, commit SHA, target, affected operation count, and conflict/recovery status. They do not expose stored content.

The UI must distinguish:

- preview invalidation from target conflict;
- retryable pending push from recovery required;
- rollback blocked by later/external file changes from a successfully created but not yet pushed rollback;
- an ordinary target configuration change from a required binding reconciliation migration.

The history view must not offer an enabled rollback command for legacy or recovery-required publications. A release detail surface should show affected paths and conflict paths so the user can understand why a safety gate stopped the operation.

## Failure Handling and Recovery

The following rules apply at every uncertain boundary:

- Failure before a commit: leave source baselines and active bindings unchanged; mark preview invalidated or failed with diagnostics.
- Commit created but push failed: retain the exact commit and immutable ledger as `pending_push`; do not advance published binding/source state.
- Push result uncertain or application crash after push: on restart, inspect the recorded commit and remote ancestry. Finalize only when the remote state proves success; otherwise use `recovery_required`.
- SQLite finalization fails after a confirmed push: retain the Git SHA and run the same idempotent reconciliation at next startup. Do not create another publish commit.
- Revert conflict or target hash mismatch: leave the original publication `published`, create no rollback commit, and keep all source/binding state unchanged.
- Any dirty workspace, diverged checkout, pending local commit unrelated to the active ledger, or target lock uncertainty blocks the operation without cleanup that could delete user content.

## Test Matrix

Pure/domain tests:

- Bindings enforce source and target article/output uniqueness.
- Output-set diff creates explicit writes/deletes for slug rename, path move, article deletion, resource add/remove/rename, and resource collision.
- Immutable operations remain stable after the pending change list is rescanned.
- State machine rejects invalid transitions and preserves target serialization.
- Source snapshots change only for the bindings accepted by a successful publication or rollback.

SQLite/repository tests:

- Schema migration preserves existing sources, scopes, snapshots, changes, targets, and history.
- Legacy publication records are visible but cannot execute automatic rollback.
- Operations, binding revisions, and target sequence persist across reopen.
- All multi-table publish/rollback finalization updates are atomic and idempotent.

Workspace/Git integration tests using temporary repositories:

- Preview then source edit invalidates confirmation without staging files.
- Preview then remote edit of an owned file blocks publish and shows the affected path.
- Unrelated remote commit fast-forwards and still allows publish.
- Two non-overlapping batches from one Scope preserve each other; two Scopes sharing one target serialize correctly.
- Push failure leaves a retryable exact commit; retry after a later scan pushes the original commit and finalizes its original transitions only.
- Publish then rollback then scan produces pending changes for only reverted bindings.
- Rollback succeeds with later unrelated batch content present.
- Rollback blocks when a later batch or external commit modifies an operated file.
- Adapter/layout migration previews old deletes and new writes, and its rollback restores the former binding outputs.
- Crash-point tests cover before commit, after commit/before push, after push/before SQLite finalization, and after rollback commit/before push.

Frontend tests:

- Confirmation calls publish with `batch_id`, never a fresh selection.
- Preview invalidation, target conflict, retryable failure, recovery required, and rollback conflict render distinct actionable states.
- History disables unavailable rollback actions and lists operation/conflict detail without displaying source bodies.

## Acceptance Criteria

This work is complete only when all of the following are true:

- No publish, retry, or rollback path derives an old target path from a current title or slug.
- Article and resource lifecycle is represented by persisted binding outputs and immutable release operations.
- A release preview and confirmation operate on the same persisted batch inputs.
- A failed push can retry the exact existing commit without depending on mutable pending change IDs.
- Rollback affects only the publication's operations and never restores a whole Scope snapshot.
- Target-side edits to easyBlog-owned files block affected operations before overwrite or delete.
- Layout changes require a visible, reversible reconciliation batch.
- SQLite stores no article/resource body or credential material.
- The complete test matrix has focused coverage at domain, storage, Git integration, and frontend contract boundaries.
