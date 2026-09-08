# Mission Control Semantic Retrieval Adapter

Semantic Retrieval provides optional vector-aware retrieval for Mission Control context generation and ranking.
It is a companion backend to the existing exact-symbol and graph retrieval layers.

## Why this adapter exists

- Repomix can serialize large context packages, but not always choose the most relevant records first.
- Repository-intelligence provides indexing and ranking signals, but needs semantic overlap for conceptual questions.
- Static-analysis findings, task dependencies, Graphify summaries, and API/architecture docs need cross-cutting retrieval beyond exact matches.

Semantic retrieval makes this possible by scoring textual similarity and producing deterministic
context candidates for Mission Control workflows.

## Optional behavior

- Qdrant is optional. If Qdrant is unavailable or disabled, local JSON indexes are used.
- No network calls are performed unless a non-default provider is configured for explicit remote use.
- Repository Intelligence, Graphify, Static-Analysis, and Git Wiki inputs are all optional.
- Falls back gracefully when optional integrations are missing.

## Data sources

- source code symbols and modules
- docs (`.md`, `.rst`, `.txt`, `.yaml`, `.yml`, `.toml`, `.json`)
- tasks (`global-issues.json`)
- decisions (`architecture-wiki.md`, `decision-log.json`, optional `git-wiki.json`)
- dependencies (`dependency-map.json`, optional `git-nexus.json`)
- static-analysis findings (`analysis-results/findings.json`)
- review summaries and graph summaries when present

### Output sources

Records are normalized as:

```json
{
  "id": "",
  "source_type": "docs|decisions|tasks|dependencies|findings|graph_summaries|reviews|code_symbols|tests",
  "repository": "",
  "path": "",
  "symbol": "",
  "task_id": "",
  "title": "",
  "text": "",
  "metadata": {}
}
```

## File layout

- `semantic-config.json` - collection and integration settings
- `embedding-profiles.json` - profile scopes and result counts
- `providers/qdrant/index.js` - optional local or remote vector backend adapter
- `providers/embeddings/local.js` - deterministic local embedding fallback
- `providers/embeddings/mock.js` - deterministic fixed-dimension mock embeddings
- `src/engine.js` - index/search logic
- `scripts/*` - CLI entry points
- `indexes/` - persisted local semantic indexes
- `fixtures/sample-semantic-output/` - sample output artifacts

## Script map

```bash
node integrations/semantic-retrieval/scripts/build-semantic-index
node integrations/semantic-retrieval/scripts/update-semantic-index
node integrations/semantic-retrieval/scripts/validate-semantic-index
node integrations/semantic-retrieval/scripts/semantic-search
node integrations/semantic-retrieval/scripts/hybrid-semantic-search
node integrations/semantic-retrieval/scripts/export-semantic-context
node integrations/semantic-retrieval/scripts/compare-retrieval-modes
```

## Integration behavior

- Repository Intelligence includes semantic retrieval results as an additional backend in its
  semantic-like workflows and hybrid ranking.
- Repomix can append optional `semantic-context.md` / `semantic-context.json` to task and PR
  context packages for downstream agent selection.
- Graphify query neighborhoods and Codebot symbol hits are merged before final ranking
  when using hybrid mode.

## Local behavior and safety

- Redacts obvious secrets (API keys, tokens, private keys, password-like strings) before embedding.
- Keeps vector output deterministic through stable IDs and deterministic normalization.
- Does not require external services to run.
