# Mission Control Skills

Shared development guidance for Mission Control. The canonical instructions are ordinary committed files in `skills/<name>/SKILL.md`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for validation, branch policy and design criteria. Agent-specific context rules are in [AGENTS.md](AGENTS.md).

## Application consumption

App repositories use their existing sync command to import `skills/` from a selected Git revision. Pin a release or commit with `SKILLS_REF` where the app's sync implementation supports it. Imported skill copies are optional, ignored local files; use each app's contributor guide for its sync command.

Do not add Git submodules or a package framework merely to distribute guidance. This repository requires no install, service or state initialization.

## Antislop

The core filter is installed at [skills/antislop/SKILL.md](skills/antislop/SKILL.md), copied unchanged from the installed upstream 3.2.20 release of [anti-slop](https://github.com/miqdadbadjuber/anti-slop/tree/v3.2.20). Its version and MIT license are included beside it. Optional concern-specific skills are not installed. Read the core's usage-mode instructions before applying it to interface or copy work; installation does not select or save a mode.
