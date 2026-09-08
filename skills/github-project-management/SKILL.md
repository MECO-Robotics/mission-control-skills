---
name: github-project-management
description: Use when explicitly asked to manage Mission Control GitHub Projects, issue triage or backlog items.
---

# GitHub project management

Project bookkeeping is optional and is not a prerequisite for a contribution.

- Identify the requested organization, project and repository from task context. Inspect existing issues/items before creating duplicates.
- Discover ProjectV2 fields and options at runtime; do not hardcode their IDs. Distinguish issues, draft items and project items when updating links.
- Match the requested scope: creating a PR does not by itself authorize creating issues, changing project status or contacting maintainers.
- Describe issues with the problem, desired outcome and acceptance criteria. Add implementation notes or dependencies only when useful; no fixed title prefix or exhaustive template is required.
- Preserve uncertain duplicate candidates for review rather than silently deleting them. Use existing authorization for requested cleanup without adding blanket confirmation gates.
- Keep tokens in CLI or server-side authentication, never in logs or documentation.
- Read back changed objects and report their URLs and any updates that could not be completed.
