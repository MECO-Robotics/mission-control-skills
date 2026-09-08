---
name: github-pr-publish-review-loop
description: Use when publishing or updating Mission Control pull requests and addressing requested review feedback.
---

# Publish and review a PR

## Branch and evidence

- Inspect status, remote, current branch and applicable contributor guidance. Preserve unrelated files.
- Use dedicated feature/fix worktrees from `origin/development`; target `development` explicitly. Main accepts development promotions or explicitly intended `hotfix/*` repairs, subject to repository rules.
- Fix promotion findings through a separate fix PR into development. There is no special `skills/*` bypass.
- Commit logical units and run relevant validation. Describe the problem, resulting behavior and commands actually run; include migration, contract or UI evidence only when affected.
- Link an existing issue when relevant. Do not create issues, update projects or post review requests unless the task authorizes those actions.
- Push and publish when authorized. Specify base/head explicitly and verify the live PR's base, head and URL. Use a structured body or `--body-file` for multiline content.

## Requested review loop

- When automated review is requested, request it on the current head and inspect review submissions, comments and unresolved threads.
- Address actionable findings, validate the correction, commit and push, then request another review if needed. Resolve only findings actually addressed.
- If the reviewer does not respond or an external requirement blocks progress, report the exact outstanding state after a bounded wait; do not manufacture approval or repeatedly retrigger unchanged work.
- A clean automated comment or reaction is feedback, not a GitHub approving review. Preserve independent required approvals, trusted checks and allowed merge methods.

Report the PR URL, validation and remaining review or merge blockers. Do not claim merge or review completion from a reaction alone.
