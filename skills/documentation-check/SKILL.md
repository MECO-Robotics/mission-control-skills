---
name: documentation-check
description: Use after changes that affect documented setup, commands, public behavior or interfaces to update the relevant documentation.
---

# Documentation check

1. Inspect the final diff for changed behavior, interfaces, commands, configuration or paths.
2. Search their names in the relevant README, contributor guide and nearby documentation. Read only the matching sections.
3. Correct stale claims and missing usage steps in existing documents. Remove references to deleted paths. Do not create historical reports or rewrite unrelated documentation.
4. Verify commands and links against the final implementation and inspect `git diff --check`.

Private refactors need no documentation churn unless the documentation describes those internals. Do not change timestamps or report a no-op audit without a useful reason.
