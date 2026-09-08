---
name: app-architecture
description: Use when changing Mission Control ownership boundaries, navigation, persistence or cross-repository contracts.
---

# App architecture

- Inspect the current behavior owner and affected consumers before choosing a repair or replacement.
- Prefer one authoritative representation, explicit dependencies and cohesive ownership. Remove superseded paths; avoid pass-through layers and splitting solely to meet file limits.
- Platform runtime validation defines the transport contract. Update affected clients, schemas, fixtures and documentation together.
- Current prototype state is disposable. Do not add legacy imports, dual writes or compatibility solely to preserve it; document intentional resets and breaking changes.
- Product confirmation behavior must follow the requested workflow, not a blanket restriction on creating project structure.
- Validate intended behavior and affected failure paths with the existing tools in each touched repository.
