---
name: gh-issue
description: Use when a user asks to create, draft, or inspect a GitHub issue in the current repository and the issue needs template-compliant scope, acceptance criteria, labels, or milestone assignment; do not use for pull requests.
---

# GitHub Issues

Use this skill when the user asks to create, draft, or inspect a GitHub issue in the current repository.

## Milestone Requirement

Before drafting, read `.agent/github-milestone-map.md` and complete its discovery and mapping protocol. Every issue must have exactly one open milestone. A missing, closed, ambiguous, stale, or unavailable milestone is a blocking condition; ask the user or report the discovery error before any remote write. Do not create a milestone from this skill.

## Workflow

1. Discover repository context with `git remote -v`, `gh repo view`, and `gh label list`; read the relevant YAML Web Form in `.github/ISSUE_TEMPLATE/` and collect its required fields in prose for a complete Markdown `--body-file`.
2. Determine the issue type (`Bug`, `Feature`, `Docs`, `Experiment`, `Proposal`, `Performance`, `Refactor`, or `CI/CD`). If type, title, problem context, scope, or acceptance criteria is missing and cannot be inferred safely, ask before creating anything.
3. Apply the shared milestone map to the issue's stated goal and affected modules. For cross-module work, choose the earliest milestone only when it is demonstrably the dependency blocker; otherwise present candidate titles with evidence and stop for the user's choice.
4. Draft a concise title and body preserving required template fields. Redact secrets, tokens, and private logs. Use only existing labels; do not create labels or assign people without explicit instruction.
5. Present the final repository, title, labels, exact milestone title and number, and body immediately before the remote write. Require confirmation of all fields.
6. After confirmation, run `gh issue create --repo OWNER/REPO --title "..." --milestone "<exact milestone title>" --body-file PATH` (and `--label` only for confirmed existing labels).
7. Verify with `gh issue view NUMBER --repo OWNER/REPO --json milestone --jq '.milestone | [.number, .title] | @tsv'`; require the selected number and title, then report the URL and number. On failure or mismatch, report the exact error and do not retry with altered content.

## Boundaries

- Never merge, close, delete, or otherwise transition an issue automatically. Those actions are outside this skill and require a separate explicit request.
- Do not execute a remote write until the user has confirmed the rendered issue content and target repository.
- Do not omit `--milestone`, use a closed milestone, or treat a label as a milestone substitute.
- Prefer read-only `gh issue list`, `gh issue view`, and `gh repo view` for inspection requests.
