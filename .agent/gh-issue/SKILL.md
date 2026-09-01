---
name: gh-issue
description: Create GitHub issues with gh using this repository's templates, scope, labels, and acceptance criteria. Use when a user asks to open or draft an issue; do not use for pull requests.
---

# GitHub Issues

Use this skill when the user asks to create, draft, or inspect a GitHub issue in the current repository.

## Workflow

1. Discover repository context with `git remote -v`, `gh repo view`, and `gh label list`. Read the relevant file in `.github/ISSUE_TEMPLATE/` before drafting. The repository currently uses YAML Web Form templates, so collect their required fields in prose and pass a complete Markdown body with `--body-file`.
2. Determine the issue type from the request (`Bug`, `Feature`, `Docs`, `Experiment`, `Proposal`, `Performance`, `Refactor`, or `CI/CD`). If type, title, problem context, scope, or acceptance criteria is missing and cannot be inferred safely, ask the user before creating anything.
3. Draft a concise title and body that preserve the selected template's required fields. Redact secrets, tokens, and private logs. Use only labels that already exist; do not create labels or assign people without explicit instruction.
4. Show the final title, labels, and body to the user immediately before the remote write. After confirmation, run `gh issue create --repo OWNER/REPO --title "..." --body-file PATH` with existing labels only when requested.
5. Report the returned URL and issue number. If creation fails, report the exact error and do not retry with altered content without user direction.

## Boundaries

- Never merge, close, delete, or otherwise transition an issue automatically. Those actions are outside this skill and require a separate explicit request.
- Do not execute a remote write until the user has confirmed the rendered issue content and target repository.
- Prefer read-only `gh issue list`, `gh issue view`, and `gh repo view` for inspection requests.
