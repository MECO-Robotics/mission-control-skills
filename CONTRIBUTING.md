# Contributing

This is the canonical shared contributor workflow for Mission Control. Application repositories document their own setup, validation commands and exceptions in their `CONTRIBUTING.md` files.

## Setup and validation

Use Git and Node.js 22 for the dependency-free shared tools. There is no root package install. Optional adapters list additional dependencies in their own READMEs; ordinary application work does not require them.

For tool changes, run the relevant existing tests, or the complete integration suite:

```sh
node --test test/integrations-*/*.test.js
git diff --check
```

For documentation-only changes, check links, documented commands and skill front matter, then run `git diff --check`. Do not repeat runtime suites for unchanged code. Each validation layer should prove distinct behavior; retain meaningful scenarios when consolidating test discovery or CI.

## Branches and review

- Keep base checkouts read-only apart from fetches and worktree creation. Implement in a dedicated `feature/*` or `fix/*` worktree based on current `origin/development`.
- Open feature/fix PRs into `development`, then promote `development` into `main` through a separate PR. Fix promotion findings through another fix PR into development.
- Use a `hotfix/*` branch from main only for an explicitly intended direct-main repair, and reconcile the resulting change into development.
- Commit logical changes, stage only their files, and specify the PR base explicitly. Verify the published base and head.
- Describe the problem, resulting behavior and actual validation. Include contract, migration/reset or UI evidence only when affected. Link an existing issue when relevant; issue creation and project bookkeeping are not prerequisites for a code PR.
- Preserve required checks, independent approving reviews and branch protections. Automated review comments or reactions do not satisfy an approving-review requirement. Use only a merge method permitted by the target branch.
- Create release tags only when a release is requested, from reviewed main. Use SemVer for the released contract.

## Design and change evidence

Prefer one clear owner, one authoritative representation and explicit dependencies. Delete obsolete paths and forwarding layers. Split code where ownership or reuse warrants it; physical file, import and directory counts are not acceptance gates.

The current prototype serves no real operational data. Prefer a coherent replacement over compatibility solely for disposable prototype state. Coordinate affected platform validation, clients, schemas, fixtures and documentation in the same change sequence. Report deliberate breaking changes and reset commands; do not claim discarded state was preserved. Establish recovery and compatibility requirements before real deployment.

Tests should exercise intended behavior, including affected failures and persistence guarantees. Existing tests are evidence, not a reason to retain broken behavior. Report commands actually run and distinguish existing failures from regressions.

## Skills and optional coordination

`skills/` is the canonical shared guidance source. Apps may explicitly synchronize a selected revision using their existing sync entrypoint; imported copies are optional, ignored local files. Edit shared guidance here rather than treating an imported copy as authoritative. Pin a commit or release where the sync command supports it. A skills import does not install adapters.

The `.mission-control/` state, `prompts/`, flat coordination skill documents and `integrations/` adapters are opt-in workflows. Use them only when selected for the task; do not initialize state, create issue IDs, generate a wiki or load indexes for ordinary coding. Read only the selected adapter reference in [ONBOARDING.md](ONBOARDING.md).
