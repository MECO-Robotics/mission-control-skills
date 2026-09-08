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

## Semantic Retrieval adapter

Mission Control now includes `integrations/semantic-retrieval/` for optional vector-aware lookup.

- Qdrant is optional and disabled unless explicitly configured.
- Default behavior is local indexing + local embedding provider, no network calls.
- Source record families:
  - code symbols / modules
  - docs / architecture docs / wiki pages
  - tasks / decisions
  - dependency references
  - static-analysis findings
  - review summaries
  - graph summaries
- Profiles control source filters and top-k:
  - `architect`
  - `coder`
  - `reviewer`
  - `maintainer`
- Optional semantic mode used by:
  - Repository Intelligence `semanticSearch` and `hybridSearch`
  - Repomix `buildTaskContext` and `buildPrContext` (via `semantic-context.md/json`)
  - Retrieval comparison and semantic context export tools

## Observability adapter

Mission Control now includes `integrations/observability/` as a local-first event log for agent workflows.

- Records trace artifacts under `observability/traces/` and `observability/trace-index.json`.
- Optional Langfuse provider exports the same trace set to `observability/langfuse-export.json` for opt-in forwarding.
- Records:
  - agent runs,
  - context-package generation,
  - retrieval sessions,
  - review loops,
  - evaluation runs.
- Integrates with:
  - Repository-Intelligence (retrieval neighbors),
  - Graphify (neighborhood context),
  - Static Analysis (findings deltas in review loops),
  - Evaluation payloads (prompt/profile linkage),
  - task/task/dep metadata from `global-issues.json` and `dependency-map.json`.

When present, `observability/prompts/registry.json` is used to resolve prompt IDs and versions for trace metadata.

Secrets are redacted in stored metadata; no prompt/runtime credentials should be intentionally passed into trace payload fields.

## Code Search adapter

Mission Control now includes `integrations/code-search/` for symbol/references/callers/implementation/API retrieval.

- Local fallback indexing extracts symbols and references from repository files.
- Sourcebot is optional and only used when available; all calls degrade to local search.
- Repository Intelligence benefits from exact symbol-first behavior via the code-search symbol feed.

## Cross-repo workflow rule (for current rollout)

This repository is the single shared source of truth for Mission Control adapter implementations and onboarding behavior used by:

- `meco-mission-control-platform`
- `meco-mission-control-mobile`
- `meco-mission-control-web`

When adapter behavior changes (e.g., retrieval, graph, analysis, evaluation, observability, semantic fallback), apply those changes in this repo first.

Then sync downstream repos through their normal cross-repo import process (no direct integration rewrites in app repos).

Current integrated adapter set in this rollout:

- Repomix
- Repository Intelligence
- Graphify
- Static Analysis
- Evaluation
- Observability
- Code Search (Sourcebot Foundation)
- Semantic Retrieval (Qdrant Foundation)
