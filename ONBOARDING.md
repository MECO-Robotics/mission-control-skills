# Mission Control Adapter Onboarding

## RepoMIX context-generation adapter

The Repomix context-generation adapter is now owned by the shared skills repo and should be consumed from:
- `integrations/repomix/`

Use this integration layer instead of duplicating context logic in platform/mobile/web.
It is optional and uses Repomix when available, with deterministic local fallback when absent.

## Repository Intelligence adapter

Mission Control now ships a repository-intelligence layer under `integrations/repository-intelligence/` that all repos should consume from.

Use it to get context-relevant files, symbols, tasks, dependencies, architecture notes, and ranked hybrid retrieval output for Codex workflows.

- Semantic search supports conceptual queries (with keyword fallback when vectors are unavailable).
- Symbol search returns exact matches with location-like metadata and nearby symbols.
- Hybrid retrieval combines semantic, symbol, task, architecture, and dependency signals.
- Retrieval helpers are available through:
  - `find_context_for_task`
  - `find_context_for_pr`
  - `find_context_for_review`
- Git Nexus and Git Wiki are optional enrichments only.

For PR review: when touching agent-context workflows, keep orchestration and ranking logic anchored here so all repos remain aligned.

## Graphify adapter

Mission Control now includes `integrations/graphify/` for optional knowledge-graph construction and retrieval.

Use Graphify to build and query relationships for:

- architecture-aware retrieval
- dependency-aware task planning
- repository/task/decision/pr neighborhoods for Codex context selection

Graphify is optional:

- If a Graphify binary is available, Mission Control can consume it.
- If unavailable, Mission Control uses local graph extraction from repository files and metadata.
- Git Nexus and Git Wiki input files are optional enrichments when present.

Graph outputs are used by:

- repository-intelligence hybrid retrieval,
- Repomix task/PR context exports,
- graph summaries for cross-repo planning.
