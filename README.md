# Mission Control Skills

Shared development guidance and optional local coordination/context tools for Mission Control. Application builds do not require the optional adapters.

## Contents

- `skills/<name>/SKILL.md`: shared skill instructions.
- `.mission-control/`, `prompts/`, and `scripts/`: coordination state and commands (`init`, `update-task`, `log-decision`, `generate-wiki`, `validate-state`).
- `integrations/`: optional context, retrieval, graph, evaluation and analysis tools; each adapter documents its commands and inputs.
- `ONBOARDING.md`: adapter reference; load only the tool relevant to the task.

Task-context export uses explicit `--file` paths or the selected task's declared files. An empty selection never triggers a repository-wide scan. See `integrations/repomix/README.md` for opt-in enrichment.

## Development and releases

Follow `AGENTS.md`: work in a dedicated `feature/*` or `fix/*` worktree based on `origin/development`, open a PR into development, then promote development to main through a separate reviewed PR. A direct main hotfix must use the documented hotfix workflow. Do not edit promotion branches to fix review findings.

Run relevant tests with `node --test test/integrations-*/*.test.js` and inspect `git diff --check`. Test discovery is explicit because the tools use Node's built-in test runner.

Release tags use SemVer: major for breaking contracts, minor for compatible functionality, patch for fixes. Create tags from the reviewed main release only when a release is requested; opening a promotion PR does not publish one.

## Application consumption

App repositories use their sync command to import `skills/` from a selected Git revision. Pin a release or commit with `SKILLS_REF` where the app's sync implementation supports it. Imported app guidance and this repository's optional tool adapters are separate; syncing `skills/` does not install the adapter stack.

Do not add Git submodules or a new package framework merely to distribute guidance. Repository-specific tracked-versus-ignored snapshot policy remains in each app's instructions until a coordinated replacement removes the variants.
