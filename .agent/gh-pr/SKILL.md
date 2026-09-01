---
name: gh-pr
description: Create GitHub pull requests with gh from a reviewed branch, reusing repository templates and recording tests. Use for drafting or opening PRs; never merge, close, or delete them automatically.
---

# GitHub Pull Requests

Use this skill when the user asks to draft or open a pull request in the current repository.

## Workflow

1. Inspect `git status --short`, `git branch --show-current`, `git remote -v`, and `gh repo view --json nameWithOwner,defaultBranchRef`. Identify the base branch from the repository default or the user's explicit choice; never guess a different target.
2. Refresh the remote base before judging the change: run `git fetch origin <base>` (or `git fetch origin` when the remote default is not yet known), then use `origin/<base>` as the comparison point. The canonical inspection commands are `git log --oneline origin/<base>..HEAD`, `git diff --stat origin/<base>...HEAD`, and `git diff --check origin/<base>...HEAD`. Never substitute a stale local `<base>` branch for this remote-tracking ref.
3. Read `.github/pull_request_template.md` and fill every required section with observable details. Record exact tests run and their results. Do not claim checks that were not run.
4. Check that the current branch is not the base branch and that its commits represent the requested scope relative to `origin/<base>`. If there are uncommitted changes, no commits, an unknown base, or missing title/body details, stop and ask the user.
5. If the branch is not on the remote, explain the pending push and ask for authorization. Only after authorization run `git push -u origin <branch>`.
6. Present the final repository, base/head branches, title, labels/reviewers (only if explicitly requested or already configured), and body. After confirmation, run `gh pr create --repo OWNER/REPO --base BASE --head HEAD --title "..." --body-file PATH`.
7. Report the returned PR URL and number. Use `gh pr view` or `gh pr checks` only for read-only follow-up.

## Boundaries

- Never merge, close, delete, approve, or auto-merge a PR. Never delete its branch.
- Do not create a PR or push commits without confirmation immediately before that remote mutation.
- Keep issue-closing keywords (`Closes #123`) only when the user explicitly supplies the issue relationship.
