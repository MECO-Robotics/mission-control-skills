# Mission Control Repomix Adapter Onboarding

The Repomix context-generation adapter is now owned by the shared skills repo and should be consumed from:
- `integrations/repomix/`

Use this integration layer instead of duplicating context logic in platform/mobile/web.
It is optional and uses Repomix when available, with deterministic local fallback when absent.

For PR review: when touching agent-context workflows, keep logic anchored here so all repos can reuse the same behavior.
