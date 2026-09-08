# Mission Control Skills

Shared development guidance and optional local coordination/context tools for Mission Control. Application builds do not require the optional adapters.

## Contents

- `skills/<name>/SKILL.md`: shared skill instructions.
- `.mission-control/`, `prompts/`, and `scripts/`: coordination state and commands (`init`, `update-task`, `log-decision`, `generate-wiki`, `validate-state`).
- `integrations/`: optional context, retrieval, graph, evaluation and analysis tools; each adapter documents its commands and inputs.
- `ONBOARDING.md`: adapter reference; load only the tool relevant to the task.

Task-context export uses explicit `--file` paths or the selected task's declared files. An empty selection never triggers a repository-wide scan. See `integrations/repomix/README.md` for opt-in enrichment.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, branch policy and design criteria. Agent-specific context rules are in [AGENTS.md](AGENTS.md).

## Application consumption

App repositories use their sync command to import `skills/` from a selected Git revision. Pin a release or commit with `SKILLS_REF` where the app's sync implementation supports it. Imported app guidance and this repository's optional tool adapters are separate; syncing `skills/` does not install the adapter stack.

Do not add Git submodules or a new package framework merely to distribute guidance. Imported skill copies are optional, ignored local files; use each app's contributor guide for its sync command.
