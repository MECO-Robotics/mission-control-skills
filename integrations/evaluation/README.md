# Mission Control Evaluation Adapter

Mission Control Evaluation adapter executes repeatable checks across:
- architect agents
- coder agents
- reviewer agents
- maintainer agents
- retrieval pipelines
- workflow/review flow pipelines

Promptfoo is the first supported evaluation backend; all other providers are optional and can be added later.

## Why this adapter exists

Mission Control already assembles context and retrieval artifacts from repository intelligence, graph structure, static analysis, and Repomix output. This adapter adds measurable evaluation so prompts, pipelines, and artifacts can be improved with objective signal.

## Optional behavior

- Promptfoo is optional. If unavailable, evaluation falls back to deterministic local scoring.
- Git Nexus, Git Wiki, Graphify, and Repository Intelligence are optional data sources.
- No network calls and no database are required.
- This module never mutates repository inputs.

## Outputs

- `evaluations/results.json`
- `evaluations/results.md`
- `evaluations/evaluation-delta.md`
- `evaluations/scorecard.md`
- `evaluations/task-context-eval.md`
- `evaluations/review-quality.md`

## Script map

```bash
node integrations/evaluation/scripts/run-evaluation --suite architect --profile coder
node integrations/evaluation/scripts/evaluate-task-context --task MC-123 --suite architect
node integrations/evaluation/scripts/evaluate-review-quality --task MC-123 --suite reviewer
node integrations/evaluation/scripts/compare-evaluations previous.json current.json
node integrations/evaluation/scripts/generate-scorecard evaluations/results.json
node integrations/evaluation/scripts/validate-agent-regression --current evaluations/results.json --baseline baselines/architect.json
node integrations/evaluation/scripts/export-evaluation-summary
```

## Suite map

- `suites/architect`
- `suites/coder`
- `suites/reviewer`
- `suites/maintainer`
- `suites/retrieval`
- `suites/workflow`

Each suite defines local benchmark cases for deterministic scoring and fallback checks.

## Integration notes

- **Repository Intelligence**: retrieval mode uses symbol/semantic/hybrid search when available.
- **Graphify**: retrieval and workflow evaluations use graph neighbors as ranking signals where available.
- **Repomix**: task context and PR context outputs are scored for relevance, missing docs/dependencies, and token budget.
- **Static Analysis**: reviewer mode compares generated findings and review artifacts to detect miss/false positives.
- **Git Nexus / Git Wiki**: when available, relationship and documentation signals contribute to architecture/review/maintainer evaluations.