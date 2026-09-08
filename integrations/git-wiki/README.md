# Git Wiki adapter

Git Wiki is an optional documentation layer on top of Mission Control.

This adapter does not add any runtime dependency to Mission Control scripts and does not
replace existing workflows. It only reads and writes files in this repository.

## Why this adapter exists

Mission Control stores machine-readable state in `.mission-control/`:

- `repo-registry.json`
- `global-issues.json`
- `dependency-map.json`
- `architecture-wiki.md`
- `cross-repo-decisions.md`

Those files are designed for automation and state validation. The Git Wiki adapter renders
human-readable, stable markdown pages that are easier to review and share.

## Optional adapter

- Optional: no script in this repository requires Git Wiki to run.
- Existing Mission Control scripts (`init`, `update-task`, `validate-state`, etc.) continue to work unchanged.
- No GitHub API calls or network calls are used.
- No databases or external services are required.

## Repository layout

- `scripts/generate-wiki-pages`
  - Generates all required wiki pages from `.mission-control/` state.
  - Uses Git Nexus data if available under `integrations/git-nexus/`.
  - Preserves `<!-- MC:MANUAL-START -->` / `<!-- MC:MANUAL-END -->` sections.
- `scripts/validate-wiki-pages`
  - Validates required pages, headings, links, task IDs, and repository names.
- `scripts/refresh-architecture-page`
  - Rebuilds `wiki/architecture.md` with architecture source, repo responsibilities, and dependency summary.
- `scripts/refresh-decision-log-page`
  - Rebuilds `wiki/decision-log.md` from `.mission-control/cross-repo-decisions.md`.
- `scripts/refresh-dependency-page`
  - Rebuilds `wiki/dependency-map.md` from `.mission-control/dependency-map.json`.
- `scripts/refresh-task-index-page`
  - Rebuilds `wiki/task-index.md` from `.mission-control/global-issues.json`.
- `wiki-config.json`
  - Defines generated output directory and required pages.
- `fixtures/`
  - Static sample output for baseline verification.

## Protected manual sections

Wiki pages are partially generated. To keep human notes safe, any text between:

- `<!-- MC:MANUAL-START -->`
- `<!-- MC:MANUAL-END -->`

is preserved during generation/refresh operations.

If a manual block is not already present in a page, generation adds a placeholder block so teams can keep notes.

## Import/export and source-of-truth alignment

- `index.md`, `repositories.md`, `dependency-map.md`, `task-index.md`, and `architecture.md` are
  regenerated from `.mission-control` files.
- `decision-log.md` is regenerated from `cross-repo-decisions.md` without editing that source log.
- Task references and repository names are validated against `global-issues.json` and `repo-registry.json`.
- Optional Git Nexus data improves traceability sections when present; missing Nexus data is not an error.

## Complement to Git Nexus graphs

Git Nexus describes relationship topology (repositories, tasks, branches, PRs, reviews, merges).
Git Wiki renders the same governance state into readable markdown that can be reviewed quickly and shared with
people who prefer docs-first workflows.

The adapter helps close the loop:

- mission-control tasks -> wiki task index and dependencies
- architecture notes -> architecture page
- cross-repo decisions -> decision log page
- Nexus relationship context -> optional traceability section

## Publish workflows

Because pages are plain Markdown files under `wiki/`, they can later be published into:

- GitHub wikis
- GitLab wikis
- static documentation sites
- any markdown-backed Git Wiki system

No new dependencies are introduced for publishing.
