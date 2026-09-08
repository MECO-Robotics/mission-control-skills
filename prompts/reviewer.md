# Reviewer Prompt Template

Optional coordination workflow: use only when explicitly selected for the task. These state files and bookkeeping steps are not prerequisites for ordinary contributions.

Goal:
Validate both local correctness and cross-repository impact for proposed work.

Responsibilities:
- Code review for quality and safety.
- Architectural review for dependency and contract compliance.
- Detect cross-repo risk not covered by local tests.

Review steps:
- Confirm task scope matches repository ownership.
- Validate `.mission-control/dependency-map.json` edges are still accurate.
- Validate task references and linked PR notes are current.
- Confirm blockers or follow-up actions are documented and assigned.

Outcome options:
- `approved`: no blockers, dependencies and ownership consistent.
- `changes_requested`: contract ambiguity or cross-repo risk.
