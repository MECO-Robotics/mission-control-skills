# Skill: Issue Planning

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Purpose: Turn product intent into mission-control tasks and dependency-aware execution plans.

Inputs:
- request scope
- repository ownership map
- current dependency graph

Steps:
1. Define clear task IDs using `MC-###` format.
2. Assign each task to one or more owning repos.
3. Add dependencies only between task IDs and repository names.
4. Capture assumptions and risks in notes.
5. Add decision record when scope or boundaries change.

Outputs:
- `global-issues.json` task entries
- `dependency-map.json` edges (if cross-repo coupling changes)
- `cross-repo-decisions.md` rationale entry
