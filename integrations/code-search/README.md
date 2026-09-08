# Mission Control Code Search Adapter

Code Search is Mission Control’s symbol- and reference-oriented retrieval layer.
It is optional and uses Sourcebot when available, then falls back to deterministic
filesystem scanning when Sourcebot is unavailable.

## Why this adapter exists

- Precise symbol/references/callers lookup for codex workflows.
- Cross-repository symbol and API usage discovery.
- Ownership and repository relationship lookups.
- Optional, non-blocking integration with existing Mission Control modules.

## Features

- Symbol search: exact and partial symbol matches.
- Reference search: where symbols are used.
- Caller search: where symbols are called.
- Implementation search: implementations of interfaces/abstracts/protocols.
- API usage search: endpoint, service, module, and library consumption.
- Cross-repository search: discover symbols and references across repositories.
- Ownership search: derive owning repository/team from mission-control metadata.
- Local deterministic index and JSON outputs.
- Optional Sourcebot backend with graceful local fallback.

## File layout

- `search-config.json` - extension and index/search defaults.
- `providers/sourcebot/index.js` - optional backend abstraction.
- `src/engine.js` - local indexer/search engine.
- `scripts/*` - command entrypoints.
- `fixtures/` - example outputs for tests and integration.

## Example usage

```bash
node integrations/code-search/scripts/index-repositories --repository-root .
node integrations/code-search/scripts/search-symbol "authenticate"
node integrations/code-search/scripts/search-references authenticationMiddleware
node integrations/code-search/scripts/search-callers authenticationMiddleware
node integrations/code-search/scripts/search-implementations AuthProvider
node integrations/code-search/scripts/search-api-usage fetch
node integrations/code-search/scripts/search-cross-repository middleware
node integrations/code-search/scripts/search-owner repo-a
node integrations/code-search/scripts/validate-search-state
```

## Result schema

```json
{
  "query": "",
  "type": "",
  "results": [
    {
      "repository": "",
      "file": "",
      "symbol": "",
      "location": "",
      "score": 0,
      "reason": ""
    }
  ]
}
```

## Integration expectations

- **Repository Intelligence**: use `search-symbol` and `search-cross-repository` results
  in hybrid ranking; exact symbol matches from this adapter are preferred when present.
- **Repomix**: task and PR context generation can include symbol definitions,
  references, callers, and implementation neighbors when `code-search` output exists.
- **Graphify**: symbol/reference artifacts can be used to enrich graph edges.
- **Static Analysis**: findings can be linked to symbols during search and retrieval.
- **Git Nexus / Git Wiki / dependencies**: ownership and related-repository heuristics
  are optional enrichments from local mission-control artifacts.

## Local-first behavior

If Sourcebot is unavailable, this adapter still works with local indexes and
filesystem scanning. No network calls are required.
