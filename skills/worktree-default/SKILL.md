---
name: worktree-default
description: Use when starting any Mission Control repository, workspace, implementation, maintenance, code, documentation, validation, or file-editing task unless the user explicitly says not to use worktrees.
---

# Worktree Default

## Rule

Assume all Mission Control work should happen in a git worktree unless the user explicitly opts out.

Do not ask for worktree consent when a git repo is available. Use base repo checkouts only for read-only inspection, fetches, and creating or entering worktrees.

## Workflow

1. Detect whether the current target is already a linked worktree.
2. If already in a linked worktree, work there.
3. If in a normal git checkout, create or enter an isolated worktree before making changes.
4. Prefer Codex-managed or harness-managed worktree tools when available; otherwise use `git worktree` with a clearly named branch.
5. If the target is not a git repo, note that worktrees do not apply and continue safely.
6. If worktree creation fails after one practical fallback, report the constraint and proceed only when the task can still be done safely.

## Scope

Apply this to implementation, bug fixes, repository maintenance, dependency updates, generated artifacts, docs edits, validation work that may create files, and any task likely to modify workspace state.

Pure read-only investigation may inspect in place, but create or enter a worktree before edits.
