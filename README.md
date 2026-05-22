# Mission Control Skills

Shared Codex skills for the Mission Control application repos.

The app repos keep `skills/` as ordinary committed files. This repo is the shared source of truth, and each app repo syncs a copy with `scripts/sync-skills.sh` or `scripts/sync-skills.ps1`.

## Layout

```text
skills/
  app-architecture/
  ui-review/
  api-review/
  documentation-check/
  frc-domain/
  github-project-management/
  github-pr-publish-review-loop/
  meco-writing-style/
```

## Update Shared Skills

```bash
git add skills
git commit -m "Update shared skills"
git push
```

## Sync App Repos

From an app repo root:

```bash
bash scripts/sync-skills.sh
git diff -- skills
git add skills
git commit -m "Sync shared skills"
git push
```

Do not use Git submodules for these skills. The app repos should contain normal committed copies of `skills/`.
