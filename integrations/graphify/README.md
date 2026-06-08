# Mission Control Graphify Adapter

Graphify creates a deterministic knowledge graph for repository context selection. Mission Control uses it to enrich context generation with structure, dependencies, and neighborhoods before assembling prompt output.

## Why this adapter exists

- Mission Control already has context packaging (Repomix) and retrieval logic (repository-intelligence).
- Graphify adds explicit graph structure across files, symbols, tasks, dependencies, decisions, repositories, and pull requests.
- This graph lets ranking and selection focus on architecture and relationships, not only keyword matching.

## Optional behavior

- Graphify is optional.
- If a Graphify binary is available, Mission Control attempts to run it.
- If Graphify is unavailable or fails, Mission Control builds a local static graph and continues.
- Mission Control works without Git Nexus and without Git Wiki.
- No network calls are required.

## Outputs

- `generated-graphs/project-graph.json` (or profile output file)
- `generated-graphs/project-graph-summary.md`
- `generated-graphs/MC-123.graph.json`
- `generated-graphs/MC-123.graph-summary.md`
- `generated-context/graph-context.md`
- `generated-context/graph-context.json`

## Script map

```bash
node integrations/graphify/scripts/build-project-graph
node integrations/graphify/scripts/build-task-graph MC-123
  # writes task-specific graph + summary
node integrations/graphify/scripts/query-project-graph "authentication middleware" --profile coder
node integrations/graphify/scripts/export-graph-context --task MC-123
node integrations/graphify/scripts/summarize-graph
node integrations/graphify/scripts/validate-graph generated-graphs/project-graph.json
node integrations/graphify/scripts/generate-graphify-config
```

## Configuration

`graphify-config.template.json` defines placeholders used by `generate-graphify-config`:

- `REPOSITORY_PATHS`
- `INCLUDE_PATTERNS`
- `IGNORE_PATTERNS`
- `OUTPUT_FILE`

## Integration notes

- Repository-intelligence reads Graphify query results when available and uses graph nodes in hybrid retrieval.
- Repomix task context can include graph context summaries through Graphify neighborhoods.
- Repo-Mix generation and validation continue to work without Graphify.

## How this differs from other adapters

- Git Nexus contains process/state data (issues, branches, PRs, reviews, merges).
- Repomix builds serialized content packages (`xml`, `md`, token reports).
- Graphify provides a graph for retrieval and relevance ranking.
