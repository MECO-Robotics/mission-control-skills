# Mission Control Architecture

## System overview

Mission Control is a non-code coordination repository that organizes how independent product repositories
move together. It stores shared context, process documents, and lightweight machine-readable state used by
Codex and human operators.

## Repository responsibilities

- `frontend`: product UI and web client behavior.
- `backend`: APIs, contracts, and platform services.
- `agents`: coordination runbooks and process tools.
- Other repos can be added to `.mission-control/repo-registry.json` without schema changes.

## Agent workflow

1. Architect creates scoped tasks and updates ownership in task status tracking.
2. Coder executes work in repo-specific branches using local repository constraints.
3. Reviewer verifies cross-repo impact and risk.
4. Maintainer coordinates promotion readiness and completion status.
5. Cross-repo changes are tracked through this repository before merge decisions.

## Review workflow

- Use repository-local PR reviews first.
- Link PR evidence and blockers in `.mission-control/global-issues.json`.
- Run `node scripts/validate-state` before marking work ready.
- Record important tradeoffs in `.mission-control/cross-repo-decisions.md`.

## Merge workflow

- Repos keep PRs aligned by repository ownership and dependency order.
- No repository claims direct ownership of another repo’s source code.
- Promotion requires dependency checks to pass and downstream impact notes to be present.

## Future Git Nexus integration

- The task and repository models are intentionally simple JSON arrays and object links.
- Reserved fields (e.g., `nexus_refs`, `branch_refs`, `pr_refs`) can be layered in later versions
  without altering current schemas.

## Future Git Wiki integration

- `architecture-wiki.md`, `cross-repo-decisions.md`, and `dependency-map.json` are canonical inputs
  for generated wiki pages.
- `scripts/generate-wiki` will render a combined snapshot that can be posted to wiki tooling later.
