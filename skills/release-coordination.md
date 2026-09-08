# Skill: Release Coordination

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Purpose: Track cross-repo readiness for release progression.

Inputs:
- current issue/dependency state
- branch and PR status notes

Workflow:
1. Confirm critical upstream dependencies are complete.
2. Validate no `blocked` tasks remain outside explicit accepted risk.
3. Confirm all release-related tasks have terminal statuses.
4. Coordinate release notes and rollback plan.

Communication:
- Prepare a concise status summary; send it to maintainers only when authorized.
- Preserve historical decisions in `.mission-control/cross-repo-decisions.md`.
