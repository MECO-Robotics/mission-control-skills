# Skill: Release Coordination

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
- Publish a concise status summary to mission-control maintainers.
- Preserve historical decisions in `.mission-control/cross-repo-decisions.md`.
