# Mission Control Skills

Shared Codex skills for the Mission Control application repos.

This repo is the shared source of truth and the only place the skill files themselves should be versioned. The Mission Control app repos import `skills/` as local ignored files from a chosen Git ref.

## Canonical Layout

```text
skills/
  <skill-name>/
    SKILL.md
```

Each skill must live in its own directory under `skills/` and must provide a `SKILL.md` file with the skill metadata and instructions.

## Versioning

Release tags use SemVer:

```text
vMAJOR.MINOR.PATCH
```

- Major: breaking workflow or skill contract changes that require coordinated app repo updates.
- Minor: new skills or compatible behavior changes.
- Patch: wording fixes, clarifications, and non-breaking instruction updates.

`main` is the integration branch for shared skill changes. App repos should pin stable releases with `SKILLS_REF=vX.Y.Z` once a release tag exists. Local testing may use `SKILLS_REF=main`, a feature branch, or a commit SHA.

## Release Workflow

```bash
git checkout -b feature/update-shared-skills origin/main
git add skills README.md
git commit -m "Update shared skills"
git push -u origin feature/update-shared-skills
```

Open a pull request into `main`, review it, and merge it. Then tag the merged release:

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

After tagging a release, announce the new tag and update the `SKILLS_REF` repository variable in `meco-mission-control-web`, `meco-mission-control-platform`, and `meco-mission-control-mobile`.

## App Repo Consumption

From an app repo root, hydrate the ignored local `skills/` directory from the configured repo and ref:

```bash
SKILLS_REF=vX.Y.Z bash scripts/sync-skills.sh
```

Do not `git add skills` in app repos. The app repos track the import scripts and ignore the imported local `skills/` directory.

Do not use Git submodules, npm packages, or copied tracked `skills/` directories for these skills.
