# Mission Control Skills

Shared development guidance for Mission Control. The canonical instructions are ordinary committed files in `skills/<name>/SKILL.md`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for validation, branch policy and design criteria. Agent-specific context rules are in [AGENTS.md](AGENTS.md).

## Application consumption

App repositories use their existing sync command to import `skills/` from a selected Git revision. Pin a release or commit with `SKILLS_REF` where the app's sync implementation supports it. Imported skill copies are optional, ignored local files; use each app's contributor guide for its sync command.

Do not add Git submodules or a package framework merely to distribute guidance. This repository requires no install, service or state initialization.
