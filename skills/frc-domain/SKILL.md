---
name: frc-domain
description: Use when writing or reviewing Mission Control behavior that depends on FRC, MECO robotics, mechanisms, subsystems, tasks, risks, or build-season workflow.
---

# FRC Domain

Mission Control supports student and mentor planning for FRC robot design, build, and competition readiness.

## Workflow

- Use FRC terms precisely: subsystem, mechanism, assembly, milestone, work log, risk, and task should not be interchangeable.
- Present Tasks and Manufacturing as one Work system through the shared `WorkItem` read model, while keeping `Task` and `ManufacturingItem` as distinct source records. Do not create a Task that merely duplicates a ManufacturingItem.
- Classify robot work as Design, Manufacturing, Assembly, Electrical/Wiring, Programming, Testing, or Driving. Keep responsible group (Mechanical, Electrical, Programming) independent of work type.
- Manufacturing process remains CNC, 3D Print, or Fabrication. Preserve its material, part, quantity, batch, mentor approval, QA, purchasing, and acquisition relationships.
- Work dependencies must connect work items of any type; keep milestone and inventory references as distinct dependency targets.
- Create mechanisms, subsystems and project structure according to the authorized product workflow.
- Distinguish intended iteration history from disposable fixture state; preserve history only where the product claims it.
- Prefer explanations and labels that help students understand ownership, blockers, and next actions.
- Keep mentor-facing summaries factual, concise, and tied to observable project data.
