# Graph Report - mission-control-skills  (2026-09-13)

## Corpus Check
- 67 files · ~15,766 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 365 nodes · 487 edges · 41 communities (19 shown, 10 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2be4806e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- _wiki-lib.js
- _nexus-lib.js
- import-nexus-data
- refresh-architecture-page
- Mission Control Wiki Index
- Mission Control Wiki Index
- AGENTS.md
- validate-state
- update-task
- refresh-task-index-page
- log-decision
- Handoff Flow
- init
- MECO Writing Principles
- Cross-Repository Decision Log
- Mission Control App
- cross-repo-decisions.md
- Git Wiki README
- GitHub PR Publish Review Loop
- dependency-map.json
- Mission Control Roadmap
- Git Nexus Adapter README
- .mission-control/global-issues.json
- .mission-control/repo-registry.json
- Architect Prompt Template
- Reviewer Prompt Template
- API Review
- documentation-check
- Review Loop

## God Nodes (most connected - your core abstractions)
1. `loadMissionState()` - 15 edges
2. `Mission Control Wiki Index` - 15 edges
3. `buildAllPages()` - 14 edges
4. `readJSON()` - 8 edges
5. `writeText()` - 8 edges
6. `loadConfig()` - 8 edges
7. `readExistingPage()` - 8 edges
8. `validateWikiPages()` - 8 edges
9. `Mission Control Wiki Index` - 8 edges
10. `loadRepoRegistry()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Mission Control State` --shares_data_with--> `.mission-control/repo-registry.json`  [EXTRACTED]
  integrations/git-nexus/README.md → wiki/architecture.md
- `Skill: Implementation` --conceptually_related_to--> `Coder Prompt Template`  [INFERRED]
  skills/implementation.md → prompts/coder.md
- `Worktree Default Skill` --conceptually_related_to--> `Agent Workflow`  [INFERRED]
  skills/worktree-default/SKILL.md → wiki/agent-workflow.md
- `Mission Control State` --shares_data_with--> `.mission-control/cross-repo-decisions.md`  [EXTRACTED]
  integrations/git-nexus/README.md → wiki/architecture.md
- `Mission Control State` --shares_data_with--> `.mission-control/global-issues.json`  [EXTRACTED]
  integrations/git-nexus/README.md → wiki/architecture.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Agent Operational Guidelines** — agents_md_core_behavior, agents_md_worktree_workflow, agents_md_git_workflow, agents_md_validation [INFERRED 0.90]
- **Mission Control Repository Ecosystem** — integrations_git_wiki_fixtures_sample_wiki_output_architecture_md_mission_control, integrations_git_wiki_fixtures_sample_wiki_output_architecture_md_frontend, integrations_git_wiki_fixtures_sample_wiki_output_architecture_md_backend, integrations_git_wiki_fixtures_sample_wiki_output_architecture_md_agents [EXTRACTED 1.00]
- **Wiki Page Hierarchy** — integrations_git_wiki_fixtures_sample_wiki_output_index, integrations_git_wiki_fixtures_sample_wiki_output_architecture, integrations_git_wiki_fixtures_sample_wiki_output_repositories, integrations_git_wiki_fixtures_sample_wiki_output_dependency_map, integrations_git_wiki_fixtures_sample_wiki_output_task_index, integrations_git_wiki_fixtures_sample_wiki_output_decision_log, integrations_git_wiki_fixtures_sample_wiki_output_agent_workflow, integrations_git_wiki_fixtures_sample_wiki_output_review_workflow, integrations_git_wiki_fixtures_sample_wiki_output_release_workflow [EXTRACTED 1.00]
- **Mission Control Repository Ecosystem** — web_repo, platform_api_repo, mobile_app_repo [EXTRACTED 1.00]
- **GitHub PR Workflow Loop** — skills_github_pr_publish_review_loop_SKILL, skills_github_pr_publish_review_loop_github_project_management, skills_github_pr_publish_review_loop_codex_review [EXTRACTED 1.00]
- **Mission Control Operational Standards** — skills_github_project_management_SKILL, skills_meco_writing_style_SKILL, skills_ui_review_SKILL [INFERRED 0.80]
- **Handoff Flow Artifacts** — wiki_agent_workflow_md_global_issues, wiki_agent_workflow_md_repo_registry, wiki_agent_workflow_md_cross_repo_decisions [EXTRACTED 1.00]
- **Wiki Core Documentation** — wiki_index, wiki_architecture, wiki_repositories, wiki_dependency_map, wiki_task_index, wiki_decision_log, wiki_agent_workflow, wiki_review_workflow, wiki_release_workflow [EXTRACTED 1.00]

## Communities (41 total, 10 thin omitted)

### Community 0 - "_wiki-lib.js"
Cohesion: 0.07
Nodes (56): args, config, outputs, {
  parseArgs,
  loadConfig,
  loadMissionState,
  buildAllPages,
  writeText,
}, state, args, config, {
  parseArgs,
  loadConfig,
  loadMissionState,
  validateWikiPages,
} (+48 more)

### Community 1 - "_nexus-lib.js"
Cohesion: 0.06
Nodes (45): args, dependencyFile, edges, errors, issuesFile, knownRepos, {
  loadRepoRegistry,
  loadIssuesFile,
  loadDependencyMapFile,
  parseArgs,
  writeJSON,
  validateGraph,
  parseStatusForTask,
  uniqueArray,
}, nodeIds (+37 more)

### Community 2 - "import-nexus-data"
Cohesion: 0.07
Nodes (34): addDependencies(), addDependencyEdge(), addLinkedPr(), adjacency, args, decisionsFile, decisionText, dependencyEntries (+26 more)

### Community 3 - "refresh-architecture-page"
Cohesion: 0.07
Nodes (32): args, config, existing, generated, output, pagePath, {
  parseArgs,
  loadConfig,
  loadMissionState,
  addManualPlaceholder,
  preserveManualSections,
  generateArchitecturePage,
  pageNameToPath,
  writeText,
  readExistingPage,
}, state (+24 more)

### Community 4 - "Mission Control Wiki Index"
Cohesion: 0.07
Nodes (28): Agent Workflow Page, Agent Workflow Sample, Architecture Page, Architecture Document, agents, backend, frontend, Mission Control (+20 more)

### Community 5 - "Mission Control Wiki Index"
Cohesion: 0.09
Nodes (26): agents Repository, backend Repository, .mission-control/cross-repo-decisions.md, MC-INIT-001: Repository scaffold initialization, frontend Repository, Git Nexus Graph Model, .mission-control/global-issues.json, Mission Control Repository (+18 more)

### Community 6 - "AGENTS.md"
Cohesion: 0.15
Nodes (14): Communication, Core Behavior, Development Workflow, Environment Preflight, General Principles, Git Workflow Rules, MECO Cross-Repo Rule, Multi-Agent Workflow Rules (+6 more)

### Community 7 - "validate-state"
Cohesion: 0.14
Nodes (12): dependencyMap, errors, fs, issues, knownRepos, MC_DIR, path, registry (+4 more)

### Community 8 - "update-task"
Cohesion: 0.15
Nodes (8): args, fs, ISSUES_PATH, path, ROOT, state, task, VALID_STATUSES

### Community 9 - "refresh-task-index-page"
Cohesion: 0.20
Nodes (9): args, config, existing, generated, output, pagePath, {
  parseArgs,
  loadConfig,
  loadMissionState,
  addManualPlaceholder,
  preserveManualSections,
  generateTaskIndexPage,
  pageNameToPath,
  writeText,
  readExistingPage,
}, state (+1 more)

### Community 10 - "log-decision"
Cohesion: 0.20
Nodes (8): args, DECISIONS_PATH, fs, note, path, required, ROOT, timestamp

### Community 11 - "Handoff Flow"
Cohesion: 0.25
Nodes (8): Worktree Default Skill, Worktree Workflow, Agent Workflow, .mission-control/cross-repo-decisions.md, .mission-control/global-issues.json, Handoff Flow, .mission-control/repo-registry.json, Agent Roles

### Community 12 - "init"
Cohesion: 0.33
Nodes (6): ensureDir(), FILES, fs, path, ROOT, writeIfMissing()

### Community 13 - "MECO Writing Principles"
Cohesion: 0.33
Nodes (6): Normalized Issue Shape, GitHub Project Management Workflow, MECO Writing Principles, GitHub Project Management Skill, MECO Writing Style Skill, UI Review Skill

### Community 14 - "Cross-Repository Decision Log"
Cohesion: 0.40
Nodes (5): Mission Control Architecture Wiki, Cross-Repository Decision Log, agents, backend, frontend

### Community 15 - "Mission Control App"
Cohesion: 0.60
Nodes (5): Mission Control App, Mobile App Repository, Platform API Repository, App Architecture Skill, Web Repository

### Community 16 - "cross-repo-decisions.md"
Cohesion: 0.50
Nodes (3): Issue Planning, Release Coordination, Wiki Refresh

### Community 17 - "Git Wiki README"
Cohesion: 0.50
Nodes (4): Git Nexus, Git Wiki README, Mission Control, frc-domain

### Community 18 - "GitHub PR Publish Review Loop"
Cohesion: 0.67
Nodes (3): GitHub PR Publish Review Loop, @codex review, github-project-management

## Knowledge Gaps
- **76 isolated node(s):** `dependencies`, `fs`, `path`, `ROOT`, `MISSION_CONTROL_DIR` (+71 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 233 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Mission Control State` connect `Mission Control Wiki Index` to `import-nexus-data`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **What connects `dependencies`, `fs`, `path` to the rest of the system?**
  _76 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `_wiki-lib.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06662770309760374 - nodes in this community are weakly interconnected._
- **Should `_nexus-lib.js` be split into smaller, more focused modules?**
  _Cohesion score 0.058069381598793365 - nodes in this community are weakly interconnected._
- **Should `import-nexus-data` be split into smaller, more focused modules?**
  _Cohesion score 0.07394957983193277 - nodes in this community are weakly interconnected._
- **Should `refresh-architecture-page` be split into smaller, more focused modules?**
  _Cohesion score 0.06722689075630252 - nodes in this community are weakly interconnected._
- **Should `Mission Control Wiki Index` be split into smaller, more focused modules?**
  _Cohesion score 0.07126436781609195 - nodes in this community are weakly interconnected._