---
name: frc-domain
description: Use when writing or reviewing Mission Control behavior that depends on FRC, MECO robotics, mechanisms, subsystems, tasks, risks, or build-season workflow.
---

# FRC Domain

Mission Control is for student and mentor teams running an FRC season. A season
has six canonical projects: Robot, Media, Outreach, Operations, Strategy, and
Training. A Project is organizational scope; a Page is an operational domain
or workflow. Keep the model specific to FRC instead of adding abstractions for
unrelated organizations.

## Projects and domains

- Keep the six canonical project types available for every season.
- Treat Home as cross-project attention and triage, and Kanban as the single
  human execution workflow across projects.
- Use Schedule for meetings, events, competitions, practices, deadlines,
  milestones, and reviews. Meeting, Event, and Milestone may remain distinct
  records within this domain. Present Schedule data through Calendar, Timeline,
  and Agenda views; these are presentations of one scheduling domain, not
  separate pages or event owners.
- Team navigation owns People followed by Teams. People owns roster,
  attendance, individual availability, and individual workload. Teams manages
  team-defined ResponsibleGroups, membership, project applicability, and
  derived group workload/capacity. Do not create a separate workload page.
- Robot owns the subsystem → mechanism → part structure and technical/CAD
  context. Inventory owns physical materials, stock, part definitions, and
  individual part instances. Purchasing owns vendors, quotes, approvals,
  orders, shipping, and cost. QA/Reports owns verification evidence and
  outcomes. Risks owns unresolved risks. Team owns people participation and
  ResponsibleGroup management. Documents owns artifacts and evidence across
  projects; links do not make Documents part of Inventory.
- Keep configuration with the domain that owns it. Avoid a generic Admin or
  Config page as a home for unrelated settings.

## Workflow

- Use FRC terms precisely: subsystem, mechanism, assembly, milestone, work log, risk, and task should not be interchangeable.
- Keep `Task` as the canonical human execution entity and label the workflow
  **Kanban**. Do not create a second human execution identity or queue for
  specialized work.
- Treat work type, responsible group, and workstream as separate dimensions.
  Work types are project-specific. A ResponsibleGroup is an arbitrary
  team-defined subteam or domain that may own Tasks through
  `responsibleGroupId`; it is not a fixed department catalog. A Workstream
  retains its distinct planning/reporting meaning. Do not infer group ownership
  from a work type, member discipline, or workstream.
- Student and student-lead cohorts such as Freshman, Sophomore, Junior, and Senior are analytics
  dimensions, not task owners. Keep Tasks assigned through existing group and
  individual assignment fields. Design cohort analytics so future non-ownership
  tags can be added without turning cohorts into ResponsibleGroups.
- Workload and capacity totals are derived from canonical Member,
  ResponsibleGroup, attendance/capacity, and Task data; never persist duplicate
  aggregates or create another workload/assignment store. Derive group members,
  planned weekly capacity, open/blocked/overdue work, estimated hours remaining,
  member assignments, and workload/capacity distribution. Cohort metrics may
  summarize student count, active/open Tasks, estimated work, and logged hours.
- Robot Kanban work types are Design, Manufacturing, Assembly,
  Electrical/Wiring, Programming, Testing, Driving, and Planning. Robot
  technical/build Planning is valid Robot work; Strategy owns game and scouting
  strategy. Other projects use appropriate FRC disciplines.
- Represent manufacturing as a Task with optional one-to-one
  `ManufacturingDetails` for technical fabrication requirements. Details do
  not have separate human status, assignment, or queue. Keep process (such as
  CNC, 3D Print, or Fabrication) separate from fulfillment source (In-house or
  Outsourced). COTS acquisition uses Purchasing without ManufacturingDetails;
  custom outsourced manufacturing keeps its technical details and links to
  Purchasing. Model `ManufacturingProcess` as a data-driven, extensible catalog,
  not a closed enum; CNC, 3D Print, and Fabrication are initial process entries.
- Purchasing records own commercial state. The associated Task represents the
  human procurement work in Kanban; do not turn PurchaseItem into a second work
  card or status owner. Store the link as `PurchaseItem.taskId`, pointing from
  PurchaseItem to Task. Keep `PurchaseItem.taskId` as the only persisted link;
  do not add a Task-side `purchaseItemId`.
- Keep Material location for raw/bulk stock. A PartInstance represents one
  physical finished part and owns its physical location/state. Derived Robot
  readiness is separate from physical location: an installed part is not
  necessarily ready, and readiness does not establish where a part is.
- Store unresolved risks in the canonical Risk model. Dependency, QA,
  schedule, or inventory signals may surface risks, but avoid parallel
  free-text risk or blocker stores. Task dependencies remain relationships.
- For evidence about manufacturing, reference its Task by default. Use a
  `manufacturing-details` target only when evidence specifically concerns
  technical fabrication requirements. Typed links allow documents and QA
  evidence to refer to their subjects without transferring ownership.
- Store an explicit `snapshotSchemaVersion` in each JSON snapshot. When a snapshot uses
  an unsupported schema version, archive the existing snapshot before resetting
  it. `npm run snapshot:reset` is destructive: it archives and removes the
  configured snapshot; the next startup creates and persists the canonical
  six-project seed. Data in the discarded snapshot is not migrated or restored.
  Do not build broad record-by-record migrations or compatibility
  fields/adapters for disposable prototype state.
- Create mechanisms, subsystems, and project structure according to the
  authorized product workflow.
- Distinguish intended iteration history from disposable fixture state; preserve history only where the product claims it.
- Prefer explanations and labels that help students understand ownership, blockers, and next actions.
- Keep mentor-facing summaries factual, concise, and tied to observable project data.
