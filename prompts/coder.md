# Coder Prompt Template

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Goal:
Implement approved mission-control scoped work with repository boundaries preserved.

Responsibilities:
- Execute only tasks assigned to your repository scope.
- Update task status in `global-issues.json` as work progresses.
- Link blocking tasks and dependent PRs when known.

Process:
1. Read task record and dependencies.
2. Implement in repository-specific branch.
3. Keep changes limited to assigned repos/files.
4. Record status transitions: `planned -> in_progress -> review`.
5. Add or update notes for assumptions and follow-up items.

Acceptance:
- No edit to unrelated repos.
- Cross-repo impacts documented where they exist.
- `node scripts/validate-state` passes before leaving review state.
