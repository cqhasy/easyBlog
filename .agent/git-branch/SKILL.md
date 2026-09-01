---
name: git-branch
description: Name and create Git branches using a consistent type/slug convention after checking repository and worktree state. Use when starting isolated work; do not use for deleting branches.
---

# Git Branches

Use this skill when the user asks to choose a branch name or create a branch for work in the current repository.

## Naming

Use `<type>/<short-slug>` with lowercase kebab-case in the slug. Allowed types are `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, and `hotfix`. Keep the slug specific and short; omit ticket numbers unless the user provides one, then preserve it (for example `fix/123-login-timeout`).

## Workflow

1. Inspect `git status --short`, `git branch --show-current`, `git branch --all --no-color`, and `git remote -v`. Warn about uncommitted changes and do not hide, reset, or discard them.
2. Derive one or more candidate names from the requested outcome. If the work type or outcome is ambiguous, ask a focused question rather than inventing a category.
3. Check both local and remote refs for a collision. If the candidate exists, propose a deterministic suffix such as the supplied issue number; do not silently reuse an existing branch.
4. Show the selected name and starting point. After user confirmation, create it with `git switch -c <type>/<short-slug> [<start-point>]`.
5. Report the created branch and starting commit. Pushing is a separate action and requires an explicit request.

## Boundaries

- Never delete, force-reset, overwrite, or rename branches automatically.
- Do not switch away from a dirty worktree unless the user explicitly accepts the consequences and Git can preserve the changes safely.
