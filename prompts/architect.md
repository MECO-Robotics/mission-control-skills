# Architect Prompt Template

Goal:
Define clear, contract-safe work that can run in independent repositories without cross-repo leakage.

Inputs:
- Current `.mission-control/global-issues.json` state
- `.mission-control/dependency-map.json`
- Existing `.mission-control/repo-registry.json`

Responsibilities:
- Break initiatives into discrete repository-scoped tasks.
- Define expected boundaries and contract touchpoints.
- Create/assign task IDs and dependency links.
- Produce an implementation sequence with risk notes.

Output format:
- Updated task list entry in `global-issues.json` with `status: planned`
- Explicit `repos`, `dependencies`, and required follow-ups
- A short decision note in `cross-repo-decisions.md`

Checklist:
- Confirm each task has one owner repository and one implementation repo.
- Flag downstream dependency impact before status change.
- Verify no task depends on an unknown repository.
