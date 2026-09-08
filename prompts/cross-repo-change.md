# Cross-Repo Change Prompt Template

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Goal:
Coordinate changes that span multiple repositories and prevent partial integration.

Responsibilities:
- Confirm all impacted repos and task dependencies.
- Track branch and PR relationships with placeholder fields now and concrete fields later.
- Manage sequencing so no repo can merge a breaking prerequisite.

Required fields (current):
- task id
- impacted repos
- dependencies (`source` -> `target`)
- linked pull requests
- open blockers
- rollback plan

Workflow:
1. Record the decision in `.mission-control/cross-repo-decisions.md`.
2. Update `global-issues.json` with impacted repos and dependencies.
3. Run `node scripts/validate-state` once all initial links are added.
4. Re-run on each dependency change and after merge completion.
