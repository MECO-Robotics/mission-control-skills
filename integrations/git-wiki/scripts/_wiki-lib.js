const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const MC_DIR = path.join(ROOT, ".mission-control");
const CONFIG_PATH = path.join(ROOT, "integrations/git-wiki/wiki-config.json");
const NEXUS_DIR = path.join(ROOT, "integrations/git-nexus");
const MANUAL_START = "<!-- MC:MANUAL-START -->";
const MANUAL_END = "<!-- MC:MANUAL-END -->";
const MANUAL_RE = new RegExp(`${MANUAL_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${MANUAL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");

const TASK_STATUS_ORDER = [
  "planned",
  "queued",
  "in_progress",
  "blocked",
  "review",
  "merged",
  "completed",
  "cancelled",
];

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }
  return { flags, positional };
}

function absolutePath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readText(filePath, fallback = "") {
  const full = absolutePath(filePath);
  if (!fs.existsSync(full)) return fallback;
  return fs.readFileSync(full, "utf8");
}

function readJSON(filePath, label = "json") {
  const full = absolutePath(filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    throw new Error(`invalid ${label}: ${error.message}`);
  }
}

function writeText(filePath, value) {
  const full = absolutePath(filePath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, value, "utf8");
}

function loadConfig() {
  return readJSON(CONFIG_PATH, "wiki config");
}

function loadRepoRegistry() {
  const raw = readJSON(path.join(MC_DIR, "repo-registry.json"), "repo registry");
  const repos = Array.isArray(raw.repos) ? raw.repos : [];
  const names = repos
    .map((repo) => (repo && typeof repo.name === "string" ? repo.name.trim() : ""))
    .filter(Boolean);
  return {
    path: path.join(MC_DIR, "repo-registry.json"),
    repos,
    names,
    nameSet: new Set(names),
    nameSetLower: new Set(names.map((repo) => repo.toLowerCase())),
  };
}

function loadGlobalIssues() {
  const raw = readJSON(path.join(MC_DIR, "global-issues.json"), "global issues");
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  return { path: path.join(MC_DIR, "global-issues.json"), tasks };
}

function loadDependencyMap() {
  const raw = readJSON(path.join(MC_DIR, "dependency-map.json"), "dependency map");
  const dependencies = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  return { path: path.join(MC_DIR, "dependency-map.json"), dependencies };
}

function loadArchitectureSource() {
  return readText(path.join(MC_DIR, "architecture-wiki.md"), "# Architecture source missing");
}

function loadDecisionSource() {
  return readText(path.join(MC_DIR, "cross-repo-decisions.md"), "# No decisions logged");
}

function loadNexusGraphIfAvailable() {
  const orderedFiles = [
    path.join(NEXUS_DIR, "exported-nexus-graph.json"),
    path.join(NEXUS_DIR, "fixtures", "sample-nexus-graph.normalized.json"),
    path.join(NEXUS_DIR, "fixtures", "sample-nexus-graph.json"),
  ];

  for (const candidate of orderedFiles) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = readJSON(candidate, path.relative(ROOT, candidate));
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) continue;
      return { file: candidate, nodes: parsed.nodes, edges: parsed.edges };
    } catch {
      continue;
    }
  }

  return null;
}

function headingSlug(value) {
  return value
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\\]^`{|}~]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractHeadings(content) {
  const headings = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) continue;
    const title = match[2].trim();
    if (!title) continue;
    headings.push({
      level: match[1].length,
      title,
      slug: headingSlug(title),
      line: `${match[1]} ${title}`,
    });
  }
  return headings;
}

function parseMarkdownLinks(content) {
  const links = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match = null;
  while ((match = pattern.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function extractTaskIds(content) {
  const tasks = new Set();
  const pattern = /\b[A-Z]{2,}-\d+\b/g;
  let match = null;
  while ((match = pattern.exec(content)) !== null) {
    tasks.add(match[0]);
  }
  return Array.from(tasks);
}

function extractRepositoryReferences(content) {
  const refs = new Set();

  const backtickPattern = /`([^`]+)`/g;
  let backtickMatch = null;
  while ((backtickMatch = backtickPattern.exec(content)) !== null) {
    const token = (backtickMatch[1] || "").trim().toLowerCase();
    if (/^[a-z][a-z0-9-]*$/.test(token)) {
      refs.add(token);
    }
  }

  const mapLikePatterns = [
    /\b(?:repo|repository|repositories|source|target)\s*:\s*([a-z][a-z0-9-]*)/gi,
    /\b(?:source|target)\s*repo\s*:\s*([a-z][a-z0-9-]*)/gi,
    /([a-z][a-z0-9-]*)\s*->\s*([a-z][a-z0-9-]*)/g,
  ];

  for (const pattern of mapLikePatterns) {
    let mapMatch = null;
    while ((mapMatch = pattern.exec(content)) !== null) {
      refs.add((mapMatch[1] || "").toLowerCase());
      if (mapMatch[2]) refs.add(mapMatch[2].toLowerCase());
    }
  }

  return Array.from(refs);
}

function extractManualBlocks(content) {
  return (content || "").match(MANUAL_RE) || [];
}

function addManualPlaceholder(content) {
  if (MANUAL_RE.test(content)) return content;
  return `${content}\n\n${MANUAL_START}\n\nAdd manual notes here.\n${MANUAL_END}\n`;
}

function preserveManualSections(existingContent, generatedContent) {
  const existing = extractManualBlocks(existingContent || "");
  if (existing.length === 0) return generatedContent;

  let index = 0;
  return (generatedContent || "").replace(MANUAL_RE, () => {
    const block = existing[index];
    index += 1;
    return block || `${MANUAL_START}\n\nAdd manual notes here.\n${MANUAL_END}`;
  });
}

function escapeTableCell(value) {
  const text = value == null ? "" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderMarkdownTable(headers, rows) {
  const safeHeaders = headers.map((header) => escapeTableCell(header));
  const body = rows.map((row) =>
    `| ${row.map((value) => escapeTableCell(value)).join(" | ")} |`
  );
  const separator = `| ${safeHeaders.map(() => "---").join(" | ")} |`;
  return [`| ${safeHeaders.join(" | ")} |`, separator, ...body].join("\n");
}

function pageNameToPath(config, pageName) {
  return path.join(ROOT, config.output_dir, pageName);
}

function readExistingPage(config, pageName) {
  return readText(pageNameToPath(config, pageName), "");
}

function buildPage(pageName, generatedBody, config, existingContent) {
  const withManual = addManualPlaceholder(generatedBody);
  return {
    path: pageNameToPath(config, pageName),
    content: preserveManualSections(existingContent || "", withManual),
  };
}

function sortTasksById(tasks) {
  return tasks.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function sortedTaskStatuses(tasks) {
  const grouped = {};
  for (const task of tasks) {
    const status = typeof task.status === "string" && task.status ? task.status : "planned";
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(task);
  }
  for (const key of Object.keys(grouped)) {
    grouped[key] = sortTasksById(grouped[key]);
  }

  const ordered = TASK_STATUS_ORDER.filter((status) => grouped[status] && grouped[status].length > 0);
  const unknownStatuses = Object.keys(grouped)
    .filter((status) => !ordered.includes(status))
    .sort();
  return { ordered: ordered.concat(unknownStatuses), grouped };
}

function taskCountByRepo(tasks, knownRepos) {
  const counts = new Map();
  for (const repoName of knownRepos) counts.set(repoName, 0);
  for (const task of tasks) {
    const repos = Array.isArray(task.repos) ? task.repos : [];
    for (const repo of repos) {
      counts.set(repo, (counts.get(repo) || 0) + 1);
    }
  }
  return counts;
}

function loadMissionState() {
  const reposFile = loadRepoRegistry();
  const issuesFile = loadGlobalIssues();
  const dependencyFile = loadDependencyMap();
  const architectureSource = loadArchitectureSource().trim();
  const decisionsText = loadDecisionSource().trim();
  const nexus = loadNexusGraphIfAvailable();

  const repoTaskCounts = taskCountByRepo(issuesFile.tasks, reposFile.names);
  return {
    reposFile,
    issuesFile,
    dependencyFile,
    architectureSource,
    decisionsText,
    nexus,
    repoTaskCounts,
  };
}

function generateIndexPage(config, state) {
  const links = config.required_pages.map((page) => `- [${page}](${page})`);
  const tasks = state.issuesFile.tasks || [];
  const deps = state.dependencyFile.dependencies || [];
  const manualDecisionCount = (state.decisionsText.match(/^##\s+/gm) || []).length;

  return [
    "# Mission Control Wiki",
    "",
    "## Required Pages",
    ...links,
    "",
    "## State Snapshot",
    `- Repositories: ${state.reposFile.repos.length}`,
    `- Tasks: ${tasks.length}`,
    `- Repository dependencies: ${deps.length}`,
    `- Decision entries: ${manualDecisionCount}`,
    "",
    `Generated from: ${path.relative(ROOT, MC_DIR)}`,
    `Nexus data source: ${state.nexus ? "optional (present)" : "not found"}`,
    "",
  ].join("\n");
}

function generateArchitecturePage(state) {
  const repoRows = state.reposFile.repos.map((repo) => [
    repo.name,
    repo.github || "",
    repo.role || "",
  ]);

  const dependencyRows = (state.dependencyFile.dependencies || []).map((dep) => [
    dep.source || "",
    dep.target || "",
    dep.reason || "",
  ]);

  const lines = [
    "# Architecture",
    "",
    "## Source Architecture",
    state.architectureSource || "No architecture source found.",
    "",
    "## Repository Responsibilities",
    "Repository ownership is sourced from `repo-registry.json`.",
    renderMarkdownTable(["Repository", "GitHub", "Role"], repoRows),
    "",
    "## Dependency Summary",
    dependencyRows.length === 0
      ? "No dependency edges are currently recorded."
      : renderMarkdownTable(["Source", "Target", "Reason"], dependencyRows),
    "",
    "## Git Nexus Relationship Context",
  ];

  if (state.nexus) {
    const nodeCounts = new Map();
    const edgeCounts = new Map();
    for (const node of state.nexus.nodes || []) {
      if (!node || typeof node.type !== "string") continue;
      nodeCounts.set(node.type, (nodeCounts.get(node.type) || 0) + 1);
    }
    for (const edge of state.nexus.edges || []) {
      if (!edge || typeof edge.type !== "string") continue;
      edgeCounts.set(edge.type, (edgeCounts.get(edge.type) || 0) + 1);
    }
    lines.push(`- Nexus graph file: ${path.basename(state.nexus.file)}`);
    lines.push(`- Nodes: ${state.nexus.nodes.length}`);
    lines.push(`- Edges: ${state.nexus.edges.length}`);
    lines.push("");
    lines.push("### Node counts");
    for (const [type, count] of nodeCounts.entries()) {
      lines.push(`- ${type}: ${count}`);
    }
    lines.push("", "### Edge counts");
    for (const [type, count] of edgeCounts.entries()) {
      lines.push(`- ${type}: ${count}`);
    }
  } else {
    lines.push("No Nexus graph was loaded for this run.");
  }

  return lines.join("\n");
}

function generateRepositoriesPage(state) {
  const rows = state.reposFile.repos.map((repo) => [
    repo.name,
    repo.github || "not-set",
    repo.role || "",
    String(state.repoTaskCounts.get(repo.name) || 0),
  ]);

  return [
    "# Repositories",
    "",
    "## Known Repositories",
    "The repository registry is the source of truth for ownership.",
    renderMarkdownTable(["Name", "GitHub", "Role", "Active Tasks"], rows),
    "",
    "## Repository Cross-Checks",
    "- Confirm all repository names in mission-state links match this registry.",
    "- New repository additions should be recorded in `.mission-control/repo-registry.json` first.",
    "",
  ].join("\n");
}

function generateDependencyPage(state) {
  const rows = [];
  for (const dependency of state.dependencyFile.dependencies || []) {
    const source = dependency.source || "";
    const target = dependency.target || "";
    const status = state.reposFile.nameSet.has(source) && state.reposFile.nameSet.has(target) ? "ok" : "unresolved";
    rows.push([
      source,
      target,
      dependency.reason || "",
      status,
    ]);
  }

  return [
    "# Dependency Map",
    "",
    "## Repository Dependencies",
    rows.length === 0
      ? "No dependencies are currently known."
      : renderMarkdownTable(["Source", "Target", "Reason", "Status"], rows),
    "",
    "## Update guidance",
    "- Source and target repositories should resolve in `.mission-control/repo-registry.json`.",
    "- Empty or unresolved rows should be removed before release review.",
    "",
  ].join("\n");
}

function generateTaskIndexPage(state) {
  const tasks = sortTasksById(state.issuesFile.tasks || []);
  const groups = sortedTaskStatuses(tasks);
  const lines = ["# Task Index", "", "## Tasks by Status"];

  for (const status of groups.ordered) {
    lines.push(`### ${status}`);
    const byStatus = groups.grouped[status] || [];
    if (byStatus.length === 0) {
      lines.push("- no tasks");
      continue;
    }
    const rows = byStatus.map((task) => [
      task.id,
      task.title || "",
      Array.isArray(task.repos) ? task.repos.join(", ") : "",
      Array.isArray(task.linked_prs) ? task.linked_prs.join(", ") : "",
      Array.isArray(task.dependencies) ? task.dependencies.join(", ") : "",
      typeof task.notes === "string" ? task.notes.replace(/\r?\n/g, " ") : "",
    ]);
    lines.push(renderMarkdownTable(["ID", "Title", "Repos", "PRs", "Dependencies", "Notes"], rows));
  }

  return lines.join("\n");
}

function generateDecisionPage(state) {
  return [
    "# Decision Log",
    "",
    "## Source Decisions",
    state.decisionsText || "No decision history available.",
    "",
  ].join("\n");
}

function generateAgentWorkflowPage() {
  return [
    "# Agent Workflow",
    "",
    "## Roles",
    "- Architect: plans and scopes cross-repository work.",
    "- Coder: implements against repository ownership boundaries.",
    "- Reviewer: validates dependency and merge safety.",
    "- Maintainer: tracks completion and release readiness.",
    "",
    "## Handoff Flow",
    "1. Read `.mission-control/global-issues.json` and `.mission-control/repo-registry.json`.",
    "2. Update task ownership and dependencies.",
    "3. Log major tradeoffs in `.mission-control/cross-repo-decisions.md`.",
    "",
  ].join("\n");
}

function generateReviewWorkflowPage() {
  return [
    "# Review Workflow",
    "",
    "## Review Objectives",
    "- Keep repository boundaries explicit.",
    "- Verify dependencies are updated and valid.",
    "- Confirm task references and linked PR evidence are present.",
    "",
    "## Review Steps",
    "1. Run `node scripts/validate-state`.",
    "2. Run `node integrations/git-wiki/scripts/validate-wiki-pages`.",
    "3. Resolve manual blockers and dependency risks before merge.",
    "",
  ].join("\n");
}

function generateReleaseWorkflowPage() {
  return [
    "# Release Workflow",
    "",
    "## Readiness",
    "- No unresolved repository references remain in wiki pages.",
    "- Task backlog is grouped and dependencies are explicit.",
    "- Decision history is up to date and not truncated.",
    "",
    "## Completion Checklist",
    "- Export or import Nexus data as needed for traceability.",
    "- Validate wiki state and mission-control state.",
    "- Confirm review order with dependency mapping.",
    "",
  ].join("\n");
}

function buildAllPages(config, stateOverride) {
  const state = stateOverride || loadMissionState();
  const pages = {
    "index.md": generateIndexPage(config, state),
    "architecture.md": generateArchitecturePage(state),
    "repositories.md": generateRepositoriesPage(state),
    "dependency-map.md": generateDependencyPage(state),
    "task-index.md": generateTaskIndexPage(state),
    "decision-log.md": generateDecisionPage(state),
    "agent-workflow.md": generateAgentWorkflowPage(),
    "review-workflow.md": generateReviewWorkflowPage(),
    "release-workflow.md": generateReleaseWorkflowPage(),
  };

  return Object.entries(pages).map(([name, body]) => {
    const existing = readExistingPage(config, name);
    return buildPage(name, body, config, existing);
  });
}

function validatePageHeading(content, expectedHeading) {
  const headings = extractHeadings(content);
  return headings.some((heading) => heading.line === expectedHeading);
}

function validateLinkTarget(sourcePageName, targetRef, availablePages) {
  const [pathPartRaw, anchorRaw] = targetRef.split("#", 2);
  if (!pathPartRaw) {
    const sourceContent = availablePages.get(path.normalize(sourcePageName).toLowerCase());
    if (!sourceContent) return { valid: false, reason: `unknown source page ${sourcePageName}` };
    const headings = extractHeadings(sourceContent);
    if (!anchorRaw) return { valid: true };
    const anchor = anchorRaw.toLowerCase();
    const hasAnchor = headings.some((heading) => heading.slug === anchor);
    return { valid: hasAnchor, reason: hasAnchor ? "" : `missing anchor ${anchorRaw} in ${sourcePageName}` };
  }

  const pathPart = pathPartRaw || "";
  let resolved = pathPart;
  if (!pathPart.includes(".md")) resolved = `${pathPart}.md`;
  resolved = resolved.replace(/^\.\//, "");
  const expectedName = path.join("wiki", resolved).toLowerCase();
  const content = availablePages.get(expectedName);
  if (!content) return { valid: false, reason: `unknown wiki page referenced: ${pathPart}` };

  if (!anchorRaw) return { valid: true };
  const headings = extractHeadings(content);
  const slug = anchorRaw.toLowerCase();
  const hasAnchor = headings.some((heading) => heading.slug === slug);
  return { valid: hasAnchor, reason: hasAnchor ? "" : `missing anchor ${anchorRaw} in ${resolved}` };
}

function validateWikiPages(config, state) {
  const errors = [];
  const requiredPages = config.required_pages || [];
  const headingsByPage = config.required_headings || {};
  const outputDir = path.join(ROOT, config.output_dir);
  const taskIds = new Set(state.issuesFile.tasks.map((task) => task.id));
  const pageTextMap = new Map();

  for (const page of requiredPages) {
    const fullPath = path.join(outputDir, page);
    const content = readText(fullPath);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing required page: ${page}`);
      continue;
    }
    pageTextMap.set(page, content);
    pageTextMap.set(path.join("wiki", page).toLowerCase(), content);
  }

  for (const [page, headings] of Object.entries(headingsByPage)) {
    const content = pageTextMap.get(page);
    if (!content) continue;
    for (const heading of headings) {
      if (!validatePageHeading(content, heading)) {
        errors.push(`missing required heading "${heading}" in ${page}`);
      }
    }
  }

  const knownRepos = new Set(state.reposFile.names.map((name) => name.toLowerCase()));
  const knownTasks = taskIds;

  for (const [pageName, content] of pageTextMap.entries()) {
    if (pageName.startsWith("wiki/")) {
      const pageBase = pageName.replace(/^wiki\//i, "");
      const links = parseMarkdownLinks(content);
      for (const target of links) {
        if (/^[a-z]+:\/\//i.test(target) || target.startsWith("mailto:")) continue;
        const targetTrimmed = target.trim();
        if (!targetTrimmed) continue;
        const result = validateLinkTarget(pageBase, targetTrimmed, pageTextMap);
        if (!result.valid) errors.push(`link error in ${pageBase}: ${result.reason}`);
      }

      for (const taskId of extractTaskIds(content)) {
        if (!knownTasks.has(taskId)) {
          errors.push(`unknown task reference in ${pageBase}: ${taskId}`);
        }
      }

      for (const repo of extractRepositoryReferences(content)) {
        if (!knownRepos.has(repo)) {
          errors.push(`unknown repository reference in ${pageBase}: ${repo}`);
        }
      }
    }
  }

  return { errors };
}

module.exports = {
  TASK_STATUS_ORDER,
  addManualPlaceholder,
  buildAllPages,
  buildPage,
  headingSlug,
  extractHeadings,
  parseMarkdownLinks,
  extractMarkdownLinks: parseMarkdownLinks,
  extractRepositoryReferences,
  extractTaskIds,
  generateAgentWorkflowPage,
  generateArchitecturePage,
  generateDecisionPage,
  generateDependencyPage,
  generateIndexPage,
  generateRepositoriesPage,
  generateReleaseWorkflowPage,
  generateReviewWorkflowPage,
  generateTaskIndexPage,
  loadConfig,
  loadDecisionSource,
  loadMissionState,
  loadNexusGraphIfAvailable,
  loadRepoRegistry,
  loadGlobalIssues,
  loadDependencyMap,
  pageNameToPath,
  parseArgs,
  preserveManualSections,
  readExistingPage,
  readJSON,
  readText,
  renderMarkdownTable,
  sortedTaskStatuses,
  taskCountByRepo,
  validateWikiPages,
  validatePageHeading,
  writeText,
};
