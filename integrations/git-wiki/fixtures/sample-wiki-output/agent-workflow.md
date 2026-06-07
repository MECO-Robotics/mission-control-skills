# Agent Workflow

## Roles
- Architect: plans and scopes cross-repository work.
- Coder: implements against repository ownership boundaries.
- Reviewer: validates dependency and merge safety.
- Maintainer: tracks completion and release readiness.

## Handoff Flow
1. Read `.mission-control/global-issues.json` and `.mission-control/repo-registry.json`.
2. Update task ownership and dependencies.
3. Log major tradeoffs in `.mission-control/cross-repo-decisions.md`.


<!-- MC:MANUAL-START -->

Add manual notes here.
<!-- MC:MANUAL-END -->
