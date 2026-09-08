# Skill: Implementation

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Purpose: Execute scoped changes with traceability and minimal cross-repo impact.

Guardrails:
- Stay inside assigned repo boundaries.
- Do not make speculative edits to unspecified repos.
- Keep task state synchronized after code changes.

Standard operating rhythm:
1. Set task status to `in_progress`.
2. Implement only repo-owned files and agreed interfaces.
3. Add follow-up notes for deferred work or discovered risk.
4. Set status to `review` with linked PR references.
5. Coordinate with maintainer for merge order.
