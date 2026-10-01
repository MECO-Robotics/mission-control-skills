---
name: api-review
description: Use when changing or reviewing Mission Control API routes, schemas, payloads, persistence, or client data contracts.
---

# API Review

The platform API is the contract source for Mission Control payloads and persistence behavior.

## Workflow

- Inspect route schemas, validators, and persistence code before changing client types.
- Distinguish request validation, runtime snapshot state, and durable database storage.
- Resolve API/client mismatches against the owning domain and its intended
  behavior; do not hide contract drift with UI fallbacks. Add routes and fields
  only when that behavior requires them.
- Keep migrations, Prisma schema changes, and route handlers scoped to the owning domain.
- Validate with API tests and typechecks, then run any affected web or mobile consumer checks.
