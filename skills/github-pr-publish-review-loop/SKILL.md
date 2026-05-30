---
name: github-pr-publish-review-loop
description: Use when creating, publishing, updating, retargeting, or repairing GitHub pull requests for MECO Mission Control, especially when PRs need repo-policy checks, linked issues, Project progress updates, connector review comments, @codex review loops, or repeated fix and re-review cycles.
---

# GitHub PR Publish Review Loop

Treat PR publishing as an end-to-end workflow: scoped branch, related issue, project status, validation evidence, PR, connector review, fixes, and a clean final state.

## Preflight

- Confirm repo, base branch, current branch, dirty files, and auth with `git status --short --branch`, `git remote -v`, and `gh auth status`.
- Read the repo's active policy before deciding the PR shape. Start with `AGENTS.md`; if missing, inspect `.github`, branch protection/ruleset notes, and existing open PR patterns.
- Use the user's newest wording as scope. Stage only in-scope files and keep unrelated dirty work untouched.
- Prefer a feature or fix branch off the requested base branch. Default Mission Control PR target is `development`; do not target `main` unless the user explicitly requests a production promotion/hotfix and repo policy allows that shape.
- Treat `MECO-Robotics/mission-control-skills` as the shared-skill source exception: when explicitly reconciling or promoting skills repo `development` to `main`, a dedicated `skills/*` repair/promotion branch may target `main`.
- Run relevant validation before publishing or after each fix pass. Use targeted checks first, then broader repo checks when the touched surface is shared.
- If connector or `gh` commands fail, try one practical fallback and continue. Do not repeat the same broken path.

## Repository Policy Gate

Do not create, retarget, update, or request review on a PR until this gate is satisfied:

- Confirm the intended base branch from the user request and repo policy. For normal Mission Control work, use `development`.
- Confirm the head branch name is allowed for that base. For PRs into `development`, use only `feature/*`, `fix/*`, or `hotfix/*`.
- For `main`, allow only `development` promotions or `hotfix/*` unless the repo is `MECO-Robotics/mission-control-skills`; in that repo, an explicitly requested skills reconciliation/promotion PR may use a `skills/*` head branch into `main`.
- Confirm the worktree started from the intended base branch, normally `origin/development` for active work. Do not patch a `development -> main` promotion branch; create a separate fix PR into `development`.
- Confirm the exact base at PR creation/update time. Use explicit flags such as `--base development --head <branch>`; never rely on GitHub's default base.
- Immediately verify the live PR after creation or retargeting:

```powershell
gh pr view <number> --json number,baseRefName,headRefName,mergeStateStatus,url
```

If `baseRefName` does not match policy, stop the review loop, retarget the PR, update the PR body, rerun checks as needed, and request a fresh connector review on the corrected head.

## Issues And Project Progress

- Search for an existing related issue before creating a new one. Check title, repo, labels, project items, and nearby feature wording.
- If no suitable issue exists and the work is more than a tiny maintenance patch, create one with problem, desired outcome, scope, acceptance criteria, implementation notes, QA, and related items.
- Link the PR to the issue in the PR body. Use closing keywords only when merge should close the issue.
- Add or update the issue in the relevant GitHub Project when project access is available. Default Mission Control context is `MECO-Robotics`, Project `1`.
- Discover ProjectV2 fields and options at runtime. Do not hardcode field IDs, option IDs, or item IDs.
- Keep progress current:
  - Set active implementation items to `In progress` or the closest available status.
  - Set waiting-on-review items to `In review` or leave a clear issue comment if that status does not exist.
  - Set externally blocked items to `Blocked` with the blocker.
  - Mark complete only after merge or explicit user direction.
- Use `github-project-management` as a companion skill for duplicate cleanup, backlog staging, or complex ProjectV2 field work.

## Publish The PR

- Commit logical units separately when changes are separable.
- Push with upstream tracking: `git push -u origin <branch>`.
- Create or update the PR with explicit base/head values, a concise title, and a body containing:

```markdown
## Summary
- ...

## Validation
- `command`

## Workflow
- Target branch: `development`
- Source branch: `fix/example`
- Policy: normal feature/fix PR into development

## Related
- Closes #123
- Project: MECO-Robotics Project 1

## Connector Review
- Requested with `@codex review`.
```

- Prefer GitHub connector PR tools when they are healthy. Use `gh pr create`, `gh pr edit`, `gh pr comment`, and `gh api graphql` as the practical fallback.
- After the PR exists, post `@codex review` unless a connector review was already triggered by the platform.
- If a PR body or branch target changes during review, update the `Workflow` and `Connector Review` sections before asking for another review.

## Connector Review Loop

Do not stop after one review request when the user asked for connector feedback or review cleanup.

1. Wait for connector feedback after posting `@codex review`.
2. Inspect review threads, top-level comments, review submissions, and the latest connector body. Use thread-aware APIs where possible.
3. If there are actionable comments, implement the smallest correct fixes, run relevant validation, commit, push, resolve addressed threads when supported, and post a fresh `@codex review`.
4. Repeat until the connector explicitly reports no further comments, no actionable findings, or equivalent clean-review language and there are no unresolved actionable threads.
5. If the connector never responds within the user's waiting budget or a branch-protection/policy blocker is external, update the issue/project status to `Blocked` or leave an issue/PR comment with the blocker, then report the exact state.

Approval-like reactions are not enough. A connector `eyes` reaction, zero flat comments, or a mergeable status does not by itself prove review completion; check the latest review/comment text and unresolved thread state.

## Common Mistakes

| Mistake | Correct behavior |
| --- | --- |
| Creating a PR without an issue for substantial work | Search first, create or link the issue, then publish |
| Hardcoding ProjectV2 field IDs | Query fields/options at runtime |
| Letting GitHub choose the PR base | Pass an explicit `--base`, then verify `baseRefName` |
| Opening normal feature/fix work against `main` | Target `development`; reserve `main` for development promotions or allowed hotfixes |
| Rejecting a `mission-control-skills` `skills/*` PR into `main` during explicit skills divergence repair | Apply the shared-skills exception, document it in the PR body, and verify the live base/head |
| Fixing review comments on a promotion PR | Open a separate fix PR into `development`, then let the promotion PR update from `development` |
| Treating resolved threads as final approval | Also inspect latest connector review/comment text |
| Stopping after one fix push | Trigger a new connector review and repeat |
| Marking the issue done before merge | Keep it in review or in progress until merge or explicit direction |
| Staging unrelated dirty files | Stage only the files in scope |

## Completion Report

Report the PR URL, issue URL, project progress updates, commits pushed, validation commands run, connector review state, and any remaining blocker. If no issue or project update was made, say why.
