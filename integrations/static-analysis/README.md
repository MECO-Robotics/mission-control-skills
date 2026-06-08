# Mission Control Static Analysis Adapter

The Static Analysis adapter turns local analyzer output into deterministic Mission Control artifacts. It currently supports Semgrep as the first backend and is structured so additional analyzers can be added without changing call-sites.

## Why this adapter exists

- Provide first-class findings for implementation, review, and merge readiness workflows.
- Keep all context generation deterministic even without external static analysis infrastructure.
- Offer optional integrations with Repomix, Repository Intelligence, and Graphify.
- Prevent legacy findings from blocking all work through baselines.

## Optional behavior

- Semgrep is optional. Mission Control falls back to local behavior when Semgrep is unavailable.
- Qdrant/Sourcebot are not required.
- Git Nexus and Git Wiki integrations remain optional and consume existing local JSON files when present.

## Outputs

`run-analysis` writes:

- `analysis-results/findings.json`
- `analysis-results/findings.md`
- `analysis-results/summary.json`

Other commands can additionally create:

- `analysis-results/analysis-delta.md`
- `analysis-results/review-findings.md`
- `analysis-results/fix-packages.json`
- `analysis-results/analysis-summary.md`

## Profiles

Profiles are configured through `analyzer-config.json`.

- `architect`: broader policy/security checks.
- `coder`: implementation-heavy checks.
- `reviewer`: review-focused checks with actionable severity emphasis.
- `maintainer`: broader repository health and dependency checks.
- `ci`: strictest merge-readiness default thresholds.

## Script map

```bash
node integrations/static-analysis/scripts/run-analysis . --profile coder
node integrations/static-analysis/scripts/parse-analysis-results <path-to-output>
node integrations/static-analysis/scripts/generate-review-findings analysis-results/findings.json
node integrations/static-analysis/scripts/generate-fix-loop analysis-results/findings.json
node integrations/static-analysis/scripts/compare-analysis-runs analysis-results/findings.json analysis-results/findings-prev.json
node integrations/static-analysis/scripts/validate-merge-readiness --pr 123 --profile reviewer
node integrations/static-analysis/scripts/export-analysis-summary
```

## Integration notes

- Repomix:
  - Task/PR context includes relevant findings from `analysis-results/findings.json`.
  - Reviewer profile prioritizes findings and historical findings when available.
- Repository Intelligence:
  - Build indexes include findings as first-class search entities.
  - Semantic/hybrid retrieval can surface findings for implementation and review.
- Graphify:
  - Findings become `finding` nodes with edges to files, symbols, tasks, and repositories.
