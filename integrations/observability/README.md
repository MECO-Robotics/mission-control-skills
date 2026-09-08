# Mission Control Observability Adapter

Mission Control observability captures what happened during agent workflows, how context was selected, and what quality signals were observed.

## Purpose

- Track agent runs for implementation, review, and merge workflows.
- Persist local trace artifacts by default.
- Link traces to prompts, context packages, retrieval outputs, static-analysis findings, and evaluations.
- Allow optional Langfuse export/sync while remaining functional without any remote provider.

## Output layout

All traces are written under:

- `observability/traces/<trace-id>.json`
- `observability/trace-index.json`
- `observability/summaries/trace-summary.md`

Each trace follows schema fields:

- `trace_id`
- `timestamp`
- `task_id`
- `repository`
- `agent_role`
- `operation`
- `prompt_id`
- `prompt_version`
- `context_package`
- `input_summary`
- `output_summary`
- `related_prs`
- `related_findings`
- `related_evaluations`
- `metadata`

## Commands

```bash
node integrations/observability/scripts/record-trace --operation agent-run --task MC-123
node integrations/observability/scripts/record-agent-run --role architect --task MC-123
node integrations/observability/scripts/record-context-package --context generated-context
node integrations/observability/scripts/record-retrieval-run --query "authentication middleware" --profile coder
node integrations/observability/scripts/record-review-loop --task MC-123 --iterations 3
node integrations/observability/scripts/record-evaluation-run --evaluation-file evaluations/results.json
node integrations/observability/scripts/export-trace-summary
node integrations/observability/scripts/compare-agent-runs <base-trace-id> <current-trace-id>
node integrations/observability/scripts/validate-trace-state
```

## Script behavior notes

- No network calls by default.
- Traces include optional redaction for keys or values that look like secrets.
- Langfuse export is optional and disabled unless explicitly configured.
- Missing integrations (repository-intelligence, graphify, static-analysis, evaluation) do not fail trace recording.

## Optional integrations supported

- **Repository-Intelligence**: enrich retrieval traces.
- **Graphify**: add graph neighborhood references to retrieval traces.
- **Static Analysis**: include finding state transitions for review loops.
- **Evaluation**: connect eval runs with trace records.
- **Langfuse**: optional provider for remote payload format.
