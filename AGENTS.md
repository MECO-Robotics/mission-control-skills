# Skills repository instructions

## Scope and context

- Implement the requested change; the user's latest direction controls scope.
- Prefer cohesive ownership and deletion of superseded code over new wrappers or arbitrary file-size limits.
- For Mission Control work, follow the workspace root direction and `CODE_CLEANUP_PLAN.md`. Read only relevant inventory rows and source; do not preload historical audits, generated indexes, or optional adapter documentation.
- Keep shared skills as ordinary committed files; do not introduce Git submodules.

## Worktrees and branches

- Base checkouts are read-only except fetch/worktree creation. Edit and run long-lived servers in dedicated worktrees outside repository roots.
- Normal `feature/*` and `fix/*` work targets `origin/development`; `hotfix/*` may target `origin/main` when explicitly intended.
- If development is missing, establish it from main before feature work. Never fix a promotion branch directly.
- Merge through PRs: feature/fix → development; development/hotfix → main. Do not merge feature branches directly into main.
- Commit, push, or open PRs when requested. Stage only in-scope files and use logical commits.

## Independent work and contracts

- Delegate broad independent work by repository or feature with disjoint write scopes; integrate and verify results centrally.
- For auth, payload, schema or API changes, inspect platform and affected clients together. Backend runtime validation defines the current transport contract; coordinated replacement is allowed by project direction.
- Do not preserve old prototype compatibility merely because it exists.

## Tools and recovery

- Once per task, check Node/npm/rg availability and versions and the worktree root.
- Prefer targeted `rg` searches; exclude dependencies, build output, VCS metadata and coverage from broad searches.
- On Windows use PowerShell-compatible syntax and `npm.cmd`; after installation refresh PATH. If packaged rg is denied, try the installed ripgrep executable once, then use PowerShell file/search commands.
- After a failed command pattern, take one practical fallback instead of retrying indefinitely. Ask only when essential information is still missing.

## Verification and reporting

- Run relevant executable tests for code changes; inspect Markdown/skill changes and run `git diff --check` (also cached diff when staged).
- Separate existing failures from regressions. Report actual commands, outcomes and remaining limitations; never claim unrun checks passed.
- If requested remote checks remain missing after push, inspect PR check status and workflow path filters; correct the trigger or deliberately retrigger, then poll with a bound.
- Give concise progress updates. Complete authorized implementation rather than ending with another proposal.
