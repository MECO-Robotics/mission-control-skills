# Mission Control Repomix Adapter

This integration layer produces deterministic repository context packages for Codex and future agent workflows.

## What it generates

- Repository context packages for an entire repository
- Task-specific context packages (`MC-123` style ids)
- PR review packages
- Reusable token-budget validation
- Human-readable context summary

Outputs are written to:

- `generated-context/repo-context.xml`
- `generated-context/task-context.xml`
- `generated-context/pr-context.xml`

with matching `*.md` summaries and token reports.

## Structure

`integrations/repomix/`
- `context-profiles.json` — profile selection for Architect/Coder/Reviewer/Maintainer
- `repomix-config.template.json` — template used by config generation
- `scripts/` — CLI entrypoints
- `fixtures/sample-context-output/` — sample package files
- `src/` — generation and validation engine

## Profiles

- `architect` — architecture docs and contracts
- `coder` — implementation and tests
- `reviewer` — source + changed/changed-like files plus test evidence
- `maintainer` — release and repository management metadata

## Command examples

```bash
node integrations/repomix/scripts/build-repo-context . coder
node integrations/repomix/scripts/build-task-context MC-123 --file src/task.ts
node integrations/repomix/scripts/build-pr-context 123
node integrations/repomix/scripts/validate-context-budget generated-context/repo-context.xml
node integrations/repomix/scripts/summarize-context generated-context/repo-context.xml
node integrations/repomix/scripts/generate-repomix-config .
```

All commands default to the repository root when no path is provided.

## Task selection

Task export reads only repeated `--file` paths relative to `--repo`, or the selected task's repository-relative `files` entries resolved through `repo-registry.json` when no file flags are supplied. Profile include/exclude filters still apply. Dependency metadata does not select dependency files. Empty or unmatched selection produces an empty manifest with an explanation; it never scans repositories or builds search indexes as a fallback.

Task graph, semantic, and static-analysis additions are opt-in through `--graph-context`, `--semantic-context`, and `--static-analysis`. These additions can expand context and generate analysis artifacts. Repository-wide and PR export commands retain their separate behavior. The exported XML and token report list the selected files; token counts remain estimates.

## Optional integrations

- **Repomix**: used when available on PATH (`repomix` by default), otherwise local scan fallback is used.
- **Git Nexus**: optional JSON inputs (`global-issues.json`, `dependency-map.json`, `repo-registry.json`, optional `git-nexus.json`) are included when present.
- **Git Wiki**: optional `git-wiki.json` metadata is included when present.
- **Graphify**: optional graph neighborhoods can be added to task and PR contexts when `integrations/graphify/` is available.

## Output metadata

All generated packages include:

```json
{
  "generated_at": "",
  "profile": "",
  "repositories": [],
  "tasks": [],
  "dependencies": [],
  "estimated_tokens": 0
}
```
