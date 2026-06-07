# Skill: Review Loop

Purpose: Keep review cycles actionable and cross-repo aware.

Review sequence:
- Confirm task metadata is current and consistent.
- Verify ownership and dependency correctness.
- Validate no missing repos in `.mission-control/repo-registry.json`.
- Ensure linked PRs and blockers are populated when in `review`.

Decision criteria:
- Approved only when dependencies resolve and status transitions are explicit.
- Block if task references are invalid or if cross-repo risk has no follow-up.

Output:
- Update task status to `completed` or `blocked`.
- Add follow-up task links for outstanding work.
