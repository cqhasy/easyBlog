# Change Log

## 2026-09-02

- Completed M1.2 Markdown normalization: source-independent articles now normalize BOM and line endings, parse deterministic flat front matter, derive display titles, record local image/download references, and reject ambiguous front matter.
- Kept final Front Matter, slug, article paths, and resource paths out of the content layer; the GitHub Pages template adapter remains responsible for those target-specific fields in M2.
- Added focused content tests and verified with `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`, `cargo test --manifest-path backend/Cargo.toml`, `npm test`, `npm run build`, and `git diff --check`.
- Recorded the Scope configuration review fixes on `feat/scope-add`: normalized include/exclude validation, recursive scope-overlap detection, optimistic revision checks for updates, accurate blocked-state labels, and guarded lifecycle actions.
- Verified the Scope review fixes with `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`, `cargo test --manifest-path backend/Cargo.toml`, `npm test`, `npm run build`, and `git diff --check`.
- Added `docs/plans/v1-development-plan.md`, covering all v1 PRD capabilities, lifecycle gates, ownership tracks, dependency graph, parallel batches, tests, release readiness, and rollback.
- Established six GitHub milestones for `cqhasy/easyBlog`: `M0 Foundation Contracts & Delivery Baseline`, `M1 Local Source Sync Vertical Slice`, `M2 GitHub Target & Release Pipeline`, `M3 Feishu Documents`, `M4 Feishu Wiki, Scheduling, Conflicts & Recovery`, and `M5 Release Readiness & v1 Sign-off`.
- No milestone due dates or GitHub Issues were created; dates and task-level assignment are intentionally deferred until staffing and estimates are available.
- Optimized `.agent/gh-issue` and `.agent/gh-pr` with a shared milestone discovery/mapping protocol, mandatory pre-write confirmation, explicit CLI milestone assignment, and post-create remote verification.
- Added `.agent/github-milestone-map.md` mapping affected modules and lifecycle stages to the six v1 milestones; ambiguous, stale, closed, or unavailable candidates now block remote writes.
