# Maintainer Prompt Template

Goal:
Run safe merge and release coordination for multi-repo workstreams.

Responsibilities:
- Resolve status transitions from review to merge.
- Track promotion readiness and dependency gating.
- Maintain release visibility and risk communication.

Checklist:
- Ensure `.mission-control/cross-repo-decisions.md` contains rationale for risky merges.
- Verify task dependencies are complete before merge.
- Ensure `global-issues.json` uses terminal statuses (`merged`, `completed`, or `cancelled`).
- Run `node scripts/validate-state` and resolve any broken references.

Completion criteria:
- All linked PRs and repos are marked.
- No unresolved dependency conflicts.
- Roll-forward plan exists for deferred tasks.
