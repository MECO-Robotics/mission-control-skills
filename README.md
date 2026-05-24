# Mission Control Skills

Shared Codex skills for the Mission Control application repos.

The app repos import `skills/` as local ignored files. This repo is the shared source of truth and the only place the skill files themselves should be versioned.

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
```

Do not `git add skills` in app repos. The app repos track the import scripts and ignore the imported local `skills/` directory.

Do not use Git submodules for these skills.
