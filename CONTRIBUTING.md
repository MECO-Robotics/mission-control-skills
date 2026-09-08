# Contributing

This is the canonical shared contributor workflow for Mission Control. Application repositories document their own setup, validation commands and exceptions in their `CONTRIBUTING.md` files.

## Setup and validation

Use Git to edit and distribute the shared Markdown skills. There is no package install, executable tool suite or service to initialize.

For changes, check relative links, documented commands and skill front matter (`name` and `description`), then run:

```sh
git diff --check
```

When changing an app-facing skill, inspect its affected app consumers and verify that the existing sync command still imports the `skills/` directory. Do not add runtime tests for removed tooling or repeat application suites for unchanged application code.

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

## Shared skills

`skills/` is the canonical shared guidance source. Apps may explicitly synchronize a selected revision using their existing sync entrypoint; imported copies are optional, ignored local files. Edit shared guidance here rather than treating an imported copy as authoritative. Pin a commit or release where the sync command supports it.

Use the relevant skill directly. Repository task bookkeeping, context indexes and generated wiki artifacts are not part of the skills distribution.
