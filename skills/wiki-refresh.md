# Skill: Wiki Refresh

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Purpose: Generate shared mission-control documentation from source-of-truth files.

Inputs:
- `.mission-control/architecture-wiki.md`
- `.mission-control/cross-repo-decisions.md`
- `.mission-control/dependency-map.json`

Process:
1. Validate required source files exist and parse cleanly.
2. Render a combined markdown snapshot.
3. Record generation timestamp.
4. Store artifact at `.mission-control/generated-wiki.md`.

Acceptance:
- Artifact includes unresolved dependencies and decision history.
- Output should remain human-readable and suitable for wiki tooling.
