### General Principles

* Prefer small, cohesive skill files and directories.
* Optimize for separation of responsibilities, not just size limits.
* Never ask to show the implementation when you can just implement the requested change.
* Do not stop to recommend changes unless you were explicitly asked to recommend options; implement the requested change instead.

---

### Core Behavior

* Default to action, not planning, unless the user explicitly asks for a plan.
* Use the user's newest wording as source of truth if scope changes mid-task.
* Make the smallest change that satisfies the request; avoid opportunistic refactors.
* If a bug is likely contract-related, inspect both frontend and backend before patching.

### Multi-Agent Workflow Rules

* Use multi-agent workflows for broad, parallelizable, or cross-repo work to tighten each agent's context and improve throughput.
* Split work by repo, feature area, ownership boundary, or independent validation track.
* Keep write scopes disjoint across agents. Use the main agent to integrate results, resolve conflicts, and run final verification.
* Do not spawn agents for tiny single-file changes, urgent blocking work, or tasks where the immediate next step depends on one result.

### Worktree-Only Workflow

* Never implement, edit files, stage, commit, or run long-lived dev servers from the base repo checkout unless the user explicitly says to work there.
* Use base repo checkouts only for read-only inspection, fetches, and creating worktrees.
* Before touching files, create or enter a dedicated temporary worktree rooted on the intended PR target branch: use `origin/development` for normal `feature/*`, `fix/*`, and hotfixes targeting `development`; use `origin/main` for `hotfix/*` branches that will PR directly into `main`.
* Keep worktree paths outside repo roots, such as workspace `_feature-branches/` or a Codex-managed worktree path.
* Use branch names matching `feature/*`, `fix/*`, or `hotfix/*`; keep each worktree scoped to one task.
* If a repo lacks `development`, create `development` from `origin/main` first, push it, then do feature work from a separate worktree branch based on `origin/development`.
* Do not apply fixes directly to a `development -> main` promotion branch. Fix findings through a worktree branch PR into `development`, then let the promotion PR update from `development`.

### Environment Preflight

Run once per task. On Windows/PowerShell, use:

```powershell
where.exe node
node -v
where.exe npm
where.exe rg
rg --version
git rev-parse --show-toplevel
```

On Linux/macOS/POSIX shells, use:

```bash
command -v node
node -v
command -v npm
command -v rg
rg --version
git rev-parse --show-toplevel
```

If `git rev-parse --show-toplevel` fails, note "not a git repo" and continue.

On Windows, assume PowerShell 5.1 semantics unless proven otherwise.

### Session Hygiene And Anti-Slowdown Rules

* After any `winget` install/update, refresh PATH in-session before using the new tool:

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
  ```

* Avoid repeated retries on the same failing command pattern; do one practical fallback immediately and continue.
* Prefer targeted searches and targeted validation over root-wide scans when possible.
* Exclude heavy folders in broad scans: `node_modules`, `dist`, `build`, `.git`, `.next`, `coverage`.

### Windows Command Rules

* Do not use `&&` in commands; use separate commands or `;`.
* On Windows, prefer `npm.cmd` over `npm` for reliability when Node tooling is present. In POSIX shells, use `npm`.
* If a command fails due to permissions/policy, try one practical fallback immediately and continue.

### rg Reliability Rules

* Treat this as a known failure mode: if `rg` resolves to a Codex WindowsApps path such as `C:\Program Files\WindowsApps\OpenAI.Codex_...\app\resources\rg.exe`, it may fail with `Access is denied`.
* If `where.exe rg` shows that WindowsApps Codex path first, or `rg --version` returns `Access is denied`, do this once:

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
  where.exe rg
  rg --version
  ```

* If still not fixed, use WinGet ripgrep directly for this session:

  ```powershell
  $rg = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\rg.exe"
  if (Test-Path $rg) { & $rg --version }
  ```

* If `rg` remains unavailable, immediately switch to PowerShell search fallback and stop retrying `rg`.

### Search And File Discovery Rules

* Prefer `rg` only if it works in the current shell.
* If `rg` returns `Access is denied`, immediately switch to PowerShell fallback and stop retrying `rg`.
* Fallback pattern: `Get-ChildItem` + `Select-String`.
* Scope searches to likely source roots first (`skills`, `scripts`, `docs`).
* If root-wide search is slow or times out, narrow to target folders before trying again.

### MECO Cross-Repo Rule

* In MECO Project Management, for auth, payload, schema, or API work, inspect both `meco-mission-control-web` and `meco-mission-control-platform` in the same pass.
* Treat backend route/schema validation as contract truth, then align web types/UI.

### Validation Before Completion

* Never claim completion without running relevant checks in touched repo(s).
* Use repo-appropriate checks. For this repo, validate Markdown/skill changes with targeted file inspection and `git diff --check`.
* When files are staged, also run `git diff --cached --check` so staged whitespace errors are not missed.
* Distinguish unrelated pre-existing warnings/errors from regressions caused by the change.
* If required GitHub checks stay pending or missing after a push, do not wait indefinitely. Inspect `gh pr view <number> --json mergeStateStatus,reviewDecision,statusCheckRollup`, check required branch-protection contexts, and confirm workflow `paths` filters include the touched files.
* If a required workflow did not trigger, update the workflow trigger paths or run a deliberate no-op workflow-touch commit so the required checks can start; then re-poll checks with a bounded wait.

### Git Workflow Rules

* If the user asks to commit, push, or open a PR, execute end-to-end.
* In dirty trees, stage only in-scope files; no blind `git add -A`.
* Use logical commits when changes are separable.
* Check auth state early with `gh auth status`; if unavailable, use git/native fallback paths.

### Communication

* Provide concise progress updates while working.
* Include what changed, why, and exact verification commands run.
* If blocked after one solid fallback attempt, ask one focused question with options.

---

### Development Workflow

* Branch model:
  * `main`: production-ready only.
  * `development`: integration branch for active work.
  * `feature/*`: short-lived feature branches.
  * `fix/*`: short-lived bugfix branches.
  * `hotfix/*`: emergency production fixes.
* PR flow:
  * Normal work moves `feature/*` or `fix/*` in a temporary worktree by PR into `development`, then `development` by PR into `main`.
  * Merge `feature/*` and `fix/*` into `development` by PR only.
  * Merge `hotfix/*` into `development` or `main` by PR only.
  * Merge into `main` only from `development` or `hotfix/*` by PR only.
* PRs into `development` must come from branches named only:
  * `feature/*`
  * `fix/*`
  * `hotfix/*`
* Do not introduce Git submodules for shared-skill sync. Use ordinary committed files plus sync/copy workflows.
