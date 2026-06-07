# Mission Control Skill Repository

This repository is the coordination layer for Mission Control development across multiple repositories.
It stores cross-repo state, procedures, and scripts so implementation repos remain focused on
application code only.

## Purpose

- Cross-repository memory and task tracking
- Codex operating procedures and role prompts
- Git Nexus-ready dependency/task linkage model
- Wiki generation source of truth
- Multi-agent coordination state

## Structure

```text
.mission-control/
  repo-registry.json
  global-issues.json
  dependency-map.json
  cross-repo-decisions.md
  architecture-wiki.md
  roadmap.md

prompts/
  architect.md
  coder.md
  reviewer.md
  maintainer.md
  cross-repo-change.md

skills/
  issue-planning.md
  implementation.md
  review-loop.md
  wiki-refresh.md
  release-coordination.md

scripts/
  init
  update-task
  log-decision
  generate-wiki
  validate-state
```

## Quick start

- `node scripts/init` creates required files if they are missing.
- `node scripts/validate-state` checks registry/task/dependency consistency.
- `node scripts/generate-wiki` produces a rendered wiki snapshot from current state files.
- `node scripts/log-decision` appends to the cross-repository decision log.
- `node scripts/update-task` updates entries in `global-issues.json`.

This repo intentionally has **no application source code** and does not call GitHub APIs.

## Shared skills compatibility

The existing `skills/*` folder can continue to host shared Codex skill content.
This mission-control scaffold adds coordination documents alongside it without changing existing
skill packages.

## Product repository minimum AGENTS entry

Every product repository participating in Mission Control should include:

```md
This repository is coordinated through the mission-control-skill repository.

For planning and coordination tasks:
- Consult mission-control-skill
- Respect repository boundaries
- Record cross-repository impacts
- Do not modify unrelated repositories
```
