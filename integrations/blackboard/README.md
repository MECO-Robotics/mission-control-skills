# Mission Control Blackboard Adapter

Mission Control blackboard is a shared, persistent working-memory layer for agents.

## Purpose

- retain hypotheses, plans, findings, decisions, risks, and action items
- preserve context across sessions and agent handoffs
- improve retrieval for implementation, review, and release workflows
- keep history append-oriented with explicit update entries

## Why it exists

Repository Intelligence and Graphify provide retrieval and structure.
Blackboard provides durable human-readable planning and coordination artifacts:

- Architect notes and architecture decisions
- Coder implementation/discovery notes
- Reviewer findings and unresolved risks
- Maintainer release/dependency context

## Board types

- `task-board`
- `repository-board`
- `review-board`
- `release-board`
- `architecture-board`

## Entry types

- `hypothesis`
- `plan`
- `finding`
- `question`
- `decision`
- `risk`
- `dependency`
- `note`
- `action_item`

## Commands

```bash
node integrations/blackboard/scripts/create-board <board-type> <board-id>
node integrations/blackboard/scripts/create-entry <board-type> <board-id> <summary> --entry-type finding
node integrations/blackboard/scripts/update-entry <board-type> <board-id> <entry-id> --status open --details "..."
node integrations/blackboard/scripts/resolve-entry <board-type> <board-id> <entry-id> --status resolved
node integrations/blackboard/scripts/search-board --query "authentication" [--board-type task-board] [--entry-type finding]
node integrations/blackboard/scripts/summarize-board <board-type> <board-id>
node integrations/blackboard/scripts/archive-board <board-type> <board-id>
node integrations/blackboard/scripts/validate-board [--board-path <path>]
```

## Output conventions

- `summarize-board` writes:
  - `board-summary.md`
  - `<board-id>.board-summary.json`
- `archive-board` writes copy under `blackboard/archives/<board-type>/<id>.json`
- engine helpers also return machine-readable payloads with generated timestamps and counts

## Optional integrations

- Repository Intelligence:
  - board entries can be searched by query, task, symbol, or finding
- Graphify:
  - board entries can be loaded for review and context enrichment
- Static-analysis:
  - findings payloads can be converted into board findings entries

## Notes

- No hard dependency on external services.
- Works even when other adapters are unavailable.
- Data files are plain JSON and intentionally human-readable.
