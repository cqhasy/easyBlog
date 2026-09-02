---
name: gh-pr
description: Use when a user asks to draft or open a GitHub pull request from a reviewed branch and the change needs repository-template compliance, test evidence, or milestone assignment; never merge, close, or delete automatically.
---

# GitHub Pull Requests

Use this skill when the user asks to draft or open a pull request in the current repository.

## Milestone Requirement

Before drafting, read `.agent/github-milestone-map.md` and complete its discovery and mapping protocol. Every PR must have exactly one open milestone. A missing, closed, ambiguous, stale, or unavailable milestone blocks the PR; do not create a PR or invent a milestone to bypass the block.

## Workflow

1. Inspect `git status --short`, `git branch --show-current`, `git remote -v`, and `gh repo view --json nameWithOwner,defaultBranchRef`. Identify the base branch from the repository default or the user's explicit choice; never guess a different target.
2. Refresh the remote base before judging the change: run `git fetch origin <base>` (or `git fetch origin` when the remote default is not yet known), then use `origin/<base>` as the comparison point. The canonical inspection commands are `git log --oneline origin/<base>..HEAD`, `git diff --stat origin/<base>...HEAD`, and `git diff --check origin/<base>...HEAD`.
3. Read `.github/pull_request_template.md` and fill every required section with observable details. Record exact tests and results; never claim checks not run.
4. Check that the current branch is not the base and commits match the requested scope. If there are uncommitted changes, no commits, unknown base, or missing title/body details, stop and ask.
5. Apply the shared milestone map to the branch diff, linked issue, and plan. If a linked issue has an open milestone, inherit it and stop on any mismatch; if it has a closed or missing milestone, stop and ask for explicit reassignment before continuing. Otherwise choose one milestone from changed modules and dependency evidence. Ambiguous candidates block the PR until the user chooses.
6. If the branch is not remote, explain the pending push and ask authorization; only then run `git push -u origin <branch>`. Push authorization is separate from and does not replace the later PR metadata/body/milestone confirmation.
7. Present repository, base/head, title, labels/reviewers, exact milestone title and number, and body. Require confirmation of all fields, then run `gh pr create --repo OWNER/REPO --base BASE --head HEAD --title "..." --milestone "<exact milestone title>" --body-file PATH`.
8. Verify with `gh pr view NUMBER --repo OWNER/REPO --json milestone --jq '.milestone | [.number, .title] | @tsv'`; require the selected number and title, then report the URL and number. On failure or mismatch, report the exact error and do not retry with altered metadata.

## Boundaries

- Never merge, close, delete, approve, or auto-merge a PR. Never delete its branch.
- Do not create a PR or push commits without confirmation immediately before that remote mutation.
- Do not omit `--milestone`, use a closed milestone, or treat a label, branch name, or linked issue text as a milestone substitute.
- Keep issue-closing keywords (`Closes #123`) only when the user explicitly supplies the issue relationship.
