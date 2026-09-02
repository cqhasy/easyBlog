# GitHub Milestone Selection

Use this shared protocol from both `$gh-issue` and `$gh-pr`. It is the single source of truth for selecting a milestone in `cqhasy/easyBlog`.

## Discovery

1. Resolve the repository from `git remote -v` or `gh repo view --json nameWithOwner`.
2. Fetch open milestones in the same turn as drafting:

   ```bash
   gh api --method GET repos/OWNER/REPO/milestones -f state=open -f per_page=100 --paginate \
     --jq '.[] | [.number, .title, .description] | @tsv'
   ```

3. Match by exact title when the user names a milestone. Never infer that a closed milestone is reusable.
4. If the fetch fails, is stale, or returns no candidate, stop before any remote write and report the exact error.

## Mapping for v1

Read `docs/plans/v1-development-plan.md` when the request concerns the v1 roadmap. Choose exactly one canonical milestone using the first matching primary area and its dependency gate:

| Primary area or evidence | Milestone |
| --- | --- |
| Contracts, IDs, SQLite, migrations, Tauri wiring, CI baseline | `M0 Foundation Contracts & Delivery Baseline` |
| Local source, Markdown files, scopes, snapshots, scans, local change review | `M1 Local Source Sync Vertical Slice` |
| GitHub target, workspace, diff, batch, commit, push, retry, history, rollback | `M2 GitHub Target & Release Pipeline` |
| Feishu OAuth, documents, blocks, assets, document conversion | `M3 Feishu Documents` |
| Feishu wiki, scheduling, conflicts, diagnostics, cross-source recovery | `M4 Feishu Wiki, Scheduling, Conflicts & Recovery` |
| Packaging, cross-platform verification, security audit, v1 sign-off | `M5 Release Readiness & v1 Sign-off` |

For a cross-module request, choose the earliest open milestone supported by the affected areas only when it is demonstrably the dependency blocker, not merely because it appears first. Exclude unrelated earlier rows and put the selected areas and dependency evidence in the body. If multiple primary areas are equally plausible, stop, show the candidate titles and evidence, and ask the user to choose; shared/supporting modules do not automatically force M0. Labels, branch names, or issue type never replace milestone evidence.

## Required Confirmation and Verification

Fetch the open list immediately before mapping and again if the issue/branch scope changes before confirmation. The pre-write summary must include the exact milestone title and API number alongside repository, title, labels, and body; PRs must also include base and head. A confirmed write must pass the exact title to the GitHub CLI (`--milestone "<title>"`; the CLI flag accepts a name). After creation, read the object back and require a non-null milestone whose number and title match the selected candidate. If it is missing or differs, report the mismatch and do not claim success.

Never create without a milestone, silently choose an arbitrary candidate, create a new milestone as a workaround, or retry with altered metadata after a creation failure.
