# Git Nexus Adapter

This adapter is optional. Mission Control functions without it, and the existing repository state and scripts remain fully usable with no external service calls.

It provides an in-repo, Git Nexus-compatible graph bridge that can:

- validate Nexus-style graph input
- normalize graph structure
- import normalized graph data into Mission Control state
- export Mission Control state back to Nexus format

## Why this adapter exists

Mission Control stores coordination state in:

- `.mission-control/repo-registry.json`
- `.mission-control/global-issues.json`
- `.mission-control/dependency-map.json`
- `.mission-control/cross-repo-decisions.md`

Those files are optimized for planning and cross-repo operations.
Git Nexus has a useful edge-node model for tracing repository, task, issue, branch, commit, PR, review, and merge history.
The adapter keeps these models aligned without introducing a runtime dependency on Git Nexus.

## Runtime notes

- No network calls.
- No GitHub API calls.
- No database.
- No Git Nexus package dependency.
- Pure Node.js scripts and local JSON files only.

## Commands

```bash
node integrations/git-nexus/scripts/validate-nexus-data --input fixtures/sample-nexus-graph.json
node integrations/git-nexus/scripts/normalize-nexus-data --input fixtures/sample-nexus-graph.json --output /tmp/normalized.json
node integrations/git-nexus/scripts/import-nexus-data --input /tmp/normalized.json
node integrations/git-nexus/scripts/export-nexus-data --output /tmp/nexus-export.json
```

## Input / output format

- Graph JSON shape (schema): `schema.json`
- Input nodes include: `repository`, `task`, `issue`, `branch`, `commit`, `pull_request`, `review`, `merge`
- Edge types include: `belongs_to`, `implements`, `contains`, `reviews`, `merges`, `depends_on`, `blocks`, `modifies`, `supersedes`

## Example trace: issue -> branch -> PR -> review -> merge

1. `issue` can `implements` a `task`.
2. `branch` or `commit` can `contains` another implementation unit.
3. `pull_request` can `contains` a `commit`.
4. `review` can `reviews` a `pull_request`.
5. `merge` can `merges` a `pull_request`.

When importing, task associations discovered through these links allow PR linkage and dependency map updates.

## Exported graph behavior

- Repository nodes are generated from `repo-registry.json`.
- Task nodes are generated from `global-issues.json`.
- Task dependencies become `depends_on` edges.
- Linked PRs in tasks become `pull_request` nodes with `modifies` edges.
- Cross-repo dependency entries become repository-level `depends_on` edges.

## Future Git Wiki generation

All source-of-truth data needed by this adapter can be exported into a deterministic Nexus graph.
That graph can be converted into wiki content in a future step by consuming:

- `architecture-wiki.md`
- `cross-repo-decisions.md`
- `dependency-map.json`
- and this Nexus-compatible output graph.
