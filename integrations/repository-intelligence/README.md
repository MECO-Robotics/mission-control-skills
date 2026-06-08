# Repository Intelligence Integration

The Repository Intelligence adapter gives Mission Control a deterministic retrieval layer for context generation and Codex workflows.
It supports semantic retrieval, symbol lookup, task/architecture/dependency-aware retrieval, and hybrid ranking across repositories.

## Use without vector infrastructure

Vector search is optional:
- Qdrant and Sourcebot integrations are only used when configured and available.
- Keyword/symbol/path fallback is always deterministic and does not require external services.
- Optional graph backend from `integrations/graphify/` is used when available to improve graph-aware hybrid retrieval.

## Top-level Layout

- `search-config.json`: engine configuration and ranking behavior
- `retrieval-profiles.json`: architect/coder/reviewer/maintainer prioritization
- `indexes/`: persisted index artifacts by domain
  - `code/`, `docs/`, `tasks/`, `dependencies/`
- `scripts/`: command wrappers
- `src/`: implementation and Codex helper APIs

## Build and search

- `scripts/build-index` and `scripts/update-index`
- `scripts/semantic-search`
- `scripts/symbol-search`
- `scripts/task-search`
- `scripts/architecture-search`
- `scripts/dependency-search`
- `scripts/hybrid-search`
- `scripts/validate-index`

## Ranking (hard order)

1. Task relevance
2. Dependency relevance
3. Repository ownership relevance
4. Semantic similarity
5. Symbol similarity
6. Documentation relevance

Weights and profile boosts are defined in `search-config.json`.

## Codex helper functions

- `find_context_for_task`
- `find_context_for_pr`
- `find_context_for_review`

These helpers return `{ files, decisions, dependencies, documentation }` in deterministic JSON order.
