const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const DEFAULT_PROFILES_PATH = path.join(__dirname, "..", "graph-profiles.json");
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, "..", "graphify-config.template.json");
const DEFAULT_OUTPUT_DIR = "generated-graphs";
const DEFAULT_GRAPH_FILE = "project-graph.json";
const DEFAULT_SUMMARY_FILE = "project-graph-summary.md";
const DEFAULT_GRAPH_CONTEXT_MD = "graph-context.md";
const DEFAULT_GRAPH_CONTEXT_JSON = "graph-context.json";

const VALID_NODE_TYPES = new Set([
  "repository",
  "file",
  "module",
  "symbol",
  "function",
  "class",
  "interface",
  "test",
  "document",
  "wiki_page",
  "task",
  "decision",
  "dependency",
  "pull_request",
  "finding",
]);
const VALID_EDGE_TYPES = new Set([
  "contains",
  "imports",
  "calls",
  "implements",
  "tests",
  "documents",
  "depends_on",
  "blocks",
  "modifies",
  "references",
  "belongs_to",
  "related_to",
  "reviews",
]);

const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".github",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  "fixtures",
  "generated-context",
  "generated-graphs",
  "tmp",
]);
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".eot",
  ".ttf",
  ".ico",
  ".exe",
  ".dll",
  ".bin",
  ".db",
  ".sqlite",
]);
const DOCUMENT_EXTS = new Set([".md", ".txt", ".rst", ".yaml", ".yml", ".json", ".toml"]);

const FALLBACK_PROFILES = {
  architect: {
    name: "architect",
    prioritize: ["repository", "module", "dependency", "decision", "wiki_page"],
    max_neighbors: 3,
    includeDirectories: [],
    includeFiles: [],
    excludeDirectories: ["generated-context", "generated-graphs"],
  },
  coder: {
    name: "coder",
    prioritize: ["file", "symbol", "function", "class", "test"],
    max_neighbors: 5,
    includeDirectories: [],
    includeFiles: [],
    excludeDirectories: ["generated-context", "generated-graphs"],
  },
  reviewer: {
    name: "reviewer",
    prioritize: ["file", "test", "pull_request", "dependency", "decision"],
    max_neighbors: 5,
    includeDirectories: [],
    includeFiles: [],
    excludeDirectories: ["generated-context", "generated-graphs"],
  },
  maintainer: {
    name: "maintainer",
    prioritize: ["repository", "task", "dependency", "pull_request", "decision"],
    max_neighbors: 4,
    includeDirectories: [],
    includeFiles: [],
    excludeDirectories: ["generated-context", "generated-graphs"],
  },
};

function toPosix(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+|\/+$/g, "");
}

function normalizeProfile(raw) {
  return {
    name: raw?.name || "coder",
    prioritize: Array.isArray(raw?.prioritize) ? raw.prioritize : ["file", "dependency", "task"],
    max_neighbors: Number.isInteger(raw?.max_neighbors) ? raw.max_neighbors : 5,
    includeDirectories: Array.isArray(raw?.includeDirectories) ? raw.includeDirectories.map(toPosix) : [],
    includeFiles: Array.isArray(raw?.includeFiles) ? raw.includeFiles.map(toPosix) : [],
    excludeDirectories: Array.isArray(raw?.excludeDirectories)
      ? raw.excludeDirectories.map(toPosix)
      : FALLBACK_PROFILES.coder.excludeDirectories,
  };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = childProcess.spawnSync(checker, [command], { encoding: "utf8" });
  return result.status === 0;
}

function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function safeText(filePath) {
  try {
    if (isBinary(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes("\u0000")) return null;
    return content;
  } catch {
    return null;
  }
}

function estimateTokens(content) {
  return Math.max(1, Math.ceil((content || "").length / 4));
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9_\/.\-]+/g) || [];
}

function normalizeSegments(base, target) {
  const rel = path.relative(base, target).split(path.sep).join("/");
  return toPosix(rel === "" ? "." : rel);
}

function readRepoRegistry(root) {
  const payload = readJson(path.join(root, "repo-registry.json")) || {};
  const repos = payload.repositories || {};
  const out = [];
  if (Array.isArray(repos)) {
    for (const row of repos) {
      const id = String(row.id || row.name || row.path || "repo");
      const repoPath = String(row.path || row.id || row.name || ".");
      out.push({ id, path: repoPath, owner: row.owner || null });
    }
  } else if (repos && typeof repos === "object") {
    for (const [id, cfg] of Object.entries(repos)) {
      const repoPath = String((cfg && cfg.path) || id);
      out.push({ id, path: repoPath, owner: cfg?.owner || null });
    }
  }
  if (out.length === 0) {
    out.push({ id: ".", path: ".", owner: null });
  }
  const dedup = new Map();
  for (const row of out) {
    const key = `${row.id}|${toPosix(row.path)}`;
    if (!dedup.has(key)) dedup.set(key, row);
  }
  return [...dedup.values()];
}

function walkFiles(rootAbs, includeDirs = [], excludeDirs = []) {
  const stack = [""];
  const files = [];
  const included = new Set(includeDirs.map(toPosix));
  const excluded = new Set([...DEFAULT_EXCLUDES, ...excludeDirs.map(toPosix)]);

  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(rootAbs, rel);
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      const relNorm = toPosix(relChild);
      const parts = relNorm.split("/").filter(Boolean);
      if (parts.some((part) => excluded.has(part) || excluded.has(parts.join("/")))) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!included.size || [...included].some((inc) => relNorm === inc || relNorm.startsWith(`${inc}/`))) {
          stack.push(relChild);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (parts.some((segment) => excluded.has(segment))) continue;
      const absChild = path.join(rootAbs, relChild);
      if (isBinary(absChild)) continue;
      if (isTextDotfile(relNorm)) continue;
      files.push(relNorm);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function isTextDotfile(relNorm) {
  return relNorm.includes("/.") && !relNorm.startsWith(".") && relNorm.includes("/.");
}

function isTestPath(relPath) {
  const normalized = relPath.toLowerCase();
  if (normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes("/__tests__/")) return true;
  return /\.(test|spec)\.[^.]+$/.test(normalized);
}

function isDocPath(relPath) {
  return DOCUMENT_EXTS.has(path.extname(relPath).toLowerCase());
}

function classifyFileType(relPath) {
  if (isTestPath(relPath)) return "test";
  if (isDocPath(relPath)) return "document";
  return "file";
}

function loadProfiles(profilePath = DEFAULT_PROFILES_PATH) {
  const abs = path.resolve(profilePath);
  const raw = readJson(abs);
  const source = raw?.profiles || raw || {};
  if (!source || Object.keys(source).length === 0) {
    return FALLBACK_PROFILES;
  }
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = normalizeProfile(value);
  }
  return { ...FALLBACK_PROFILES, ...out };
}

function loadGitignore(root) {
  const file = path.join(root, ".gitignore");
  if (!fs.existsSync(file)) return [];
  const data = safeText(file);
  if (data == null) return [];
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(toPosix);
}

function makeSafeToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9._\-@+/]/gi, "-")
    .replace(/-{2,}/g, "-");
}

function makeNodeId(type, ...parts) {
  return `${type}:${parts.filter(Boolean).map(makeSafeToken).join("|")}`;
}

function addNode(nodesById, payload) {
  let id = payload.id;
  if (!id) {
    if (payload.node_type === "repository") {
      id = `repository:${makeSafeToken(payload.repository || payload.id || "item")}`;
    } else if (payload.node_type === "task") {
      id = `task:${makeSafeToken(payload.task_id || payload.title || "item")}`;
    } else {
      id = makeNodeId(payload.node_type, payload.repository || "", payload.file || "", payload.symbol || payload.title || "item");
    }
  }
  if (!nodesById.has(id)) {
    nodesById.set(id, {
      id,
      node_type: payload.node_type,
      repository: payload.repository || null,
      file: payload.file || null,
      symbol: payload.symbol || null,
      path: payload.path || payload.file || null,
      title: payload.title || null,
      task_id: payload.task_id || null,
      content: payload.content || null,
      tokens: payload.tokens,
      metadata: payload.metadata || {},
    });
  }
  return id;
}

function addEdge(edgesById, from, to, type, metadata = {}) {
  if (!from || !to) return null;
  const key = `${from}|${type}|${to}`;
  if (edgesById.has(key)) return key;
  edgesById.set(key, { from, to, type, metadata });
  return key;
}

function collectTasks(root) {
  const source = readJson(path.join(root, "global-issues.json"));
  const rows = Array.isArray(source?.tasks) ? source.tasks : [];
  return rows
    .map((task) => {
      const id = String(task?.id || "").toUpperCase();
      if (!id) return null;
      return {
        id,
        title: task.title || "",
        description: task.description || "",
        repository: task.repository || task.repo || null,
        files: Array.isArray(task.files) ? task.files : [],
        decisions: Array.isArray(task.decisions) ? task.decisions : [],
        tags: Array.isArray(task.tags) ? task.tags : [],
        state: task.state || "open",
      };
    })
    .filter(Boolean);
}

function collectDependencyMap(root) {
  const source = readJson(path.join(root, "dependency-map.json"));
  const rows = Array.isArray(source?.dependencies) ? source.dependencies : [];
  return rows
    .map((row) => ({
      from: String(row.from || "").toUpperCase(),
      to: String(row.to || "").toUpperCase(),
      type: row.type || "depends_on",
      repository: row.repository || row.repo || null,
      file: row.file || null,
      taskId: row.taskId ? String(row.taskId).toUpperCase() : null,
    }))
    .filter((row) => row.from && row.to);
}

function collectDecisionRecords(root) {
  const source = readJson(path.join(root, "decision-log.json"));
  const rows = Array.isArray(source?.decisions) ? source.decisions : [];
  return rows
    .map((row) => ({
      id: String(row?.id || row?.title || "").trim(),
      title: row?.title || "",
      text: row?.text || "",
      repository: row?.repository || null,
      taskId: String(row?.taskId || row?.task || "").toUpperCase() || null,
    }))
    .filter((row) => row.id);
}

function collectWikiRecords(root) {
  const source = readJson(path.join(root, "git-wiki.json"));
  if (!source) return { pages: [], decisions: [] };
  const pages = Array.isArray(source.pages) ? source.pages : [];
  const decisions = Array.isArray(source.decisions) ? source.decisions : [];
  return {
    pages: pages
      .map((page) => ({
        id: String(page?.id || page?.path || page?.title || "").trim(),
        title: page?.title || "",
        path: page?.path || "",
        content: page?.content || "",
        repository: page?.repository || null,
        taskId: String(page?.taskId || page?.task || "").toUpperCase() || null,
      }))
      .filter((page) => page.id),
    decisions: decisions
      .map((row) => ({
        id: String(row?.id || row?.title || "").trim(),
        title: row?.title || "",
        text: row?.text || "",
        repository: row?.repository || null,
        taskId: String(row?.taskId || row?.task || "").toUpperCase() || null,
      }))
      .filter((row) => row.id),
  };
}

function collectNexusRecords(root) {
  const source = readJson(path.join(root, "git-nexus.json"));
  if (!source) return { tasks: [], prs: [] };
  return {
    tasks: Array.isArray(source.tasks)
      ? source.tasks.map((row) => ({
          id: String(row?.id || "").toUpperCase(),
          relatedBranches: Array.isArray(row?.relatedBranches) ? row.relatedBranches : [],
          relatedPrs: Array.isArray(row?.relatedPrs) ? row.relatedPrs : [],
          relatedIssues: Array.isArray(row?.relatedIssues) ? row.relatedIssues : [],
          dependencyChains: Array.isArray(row?.dependencyChains) ? row.dependencyChains : [],
          blockedBy: Array.isArray(row?.blockedBy) ? row.blockedBy : [],
          reviews: Array.isArray(row?.reviews) ? row.reviews : [],
        })).filter((row) => row.id)
      : [],
    prs: Array.isArray(source.prs)
      ? source.prs.map((row) => ({
          number: Number(row?.number || row?.id || 0),
          relatedTasks: Array.isArray(row?.relatedTasks)
            ? row.relatedTasks.map((taskId) => String(taskId).toUpperCase())
            : [],
          changedFiles: Array.isArray(row?.changedFiles) ? row.changedFiles : [],
          repositories: Array.isArray(row?.repositories) ? row.repositories : [],
          decisions: Array.isArray(row?.decisions) ? row.decisions : [],
        }))
      : [],
  };
}

function collectArchitectureFiles(rootAbs) {
  const docPath = path.join(rootAbs, "architecture-wiki.md");
  const content = safeText(docPath);
  if (!content) return null;
  return { repository: ".", file: "architecture-wiki.md", title: "architecture-wiki", content };
}

function extractSymbolRows(content) {
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    { kind: "function", re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "class", re: /(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "interface", re: /(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "module", re: /(?:export\s+)?namespace\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
  ];
  const rows = [];
  for (const spec of patterns) {
    const re = new RegExp(spec.re);
    let match = null;
    while ((match = re.exec(content || "")) !== null) {
      const symbol = String(match[1] || "").trim();
      if (!symbol) continue;
      const lineNo = String((content.slice(0, match.index).match(/\r?\n/g) || []).length + 1);
      const snippet = String(lines[Number(lineNo) - 1] || "").trim();
      rows.push({ kind: spec.kind, symbol, line: Number(lineNo), snippet });
    }
  }
  return rows;
}

function extractImports(content) {
  const out = [];
  const importFrom = /import\s+[^'"]*['"]([^'"]+)['"]/g;
  const requireFrom = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of String(content || "").matchAll(importFrom)) {
    if (match[1]) out.push(match[1]);
  }
  for (const match of String(content || "").matchAll(requireFrom)) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function resolveImportTarget(repoAbs, importerRel, target) {
  if (!target || target.startsWith("http")) return null;
  if (!target.startsWith(".") && !target.startsWith("/")) return null;
  const clean = target.replace(/["']/g, "");
  const importerDir = path.dirname(path.join(repoAbs, importerRel));
  const candidate = path.resolve(importerDir, clean);
  const candidates = [candidate, `${candidate}.js`, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.jsx`, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.py`, `${candidate}.java`];
  for (const candidateAbs of candidates) {
    const indexFile = `${candidateAbs}/index.js`;
    const indexAlt = `${candidateAbs}/index.ts`;
    for (const file of [candidateAbs, indexFile, indexAlt]) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return toPosix(path.relative(repoAbs, file));
      }
    }
  }
  return null;
}

function locateNodeByFile(nodesById, repository, file) {
  const normalized = toPosix(file).replace(/^\.\//, "");
  for (const node of nodesById.values()) {
    if (!["file", "test", "document"].includes(node.node_type)) continue;
    if (node.repository === repository && toPosix(node.file || "") === normalized) return node.id;
    if (node.repository === "." && toPosix(node.file || "") === normalized) return node.id;
  }
  return null;
}

function collectStaticFindings(repositoryRoot) {
  const payload = readJson(path.join(repositoryRoot, "analysis-results", "findings.json"));
  if (!payload || !Array.isArray(payload.findings)) {
    return [];
  }
  return payload.findings
    .map((row) => ({
      id: String(row.id || "").trim(),
      repository: row.repository || ".",
      file: row.file || null,
      line: Number(row.line || 0),
      rule: row.rule || null,
      message: row.message || "",
      category: row.category || "general",
      severity: row.severity || "info",
      recommendation: row.recommendation || "",
      symbol: row.symbol || null,
      taskId: String(row.taskId || row.metadata?.taskId || "").toUpperCase() || null,
      source: row.source || "static-analysis",
    }))
    .filter((row) => row.repository);
}

function collectGraphData(repositoryRoot, profile) {
  const root = path.resolve(repositoryRoot);
  const repos = readRepoRegistry(root);
  const nodesById = new Map();
  const edgesById = new Map();

  const repositoryNodes = [];
  const repoPathById = new Map();
  for (const repo of repos) {
    const repoId = String(repo.id || ".");
    const repoPath = toPosix(repo.path || ".");
    const repoAbs = path.resolve(root, repoPath);
    repoPathById.set(repoId, repoAbs);
    const repoNode = addNode(nodesById, {
      node_type: "repository",
      repository: repoId,
      path: repoPath,
      title: repoId,
      metadata: { owner: repo.owner || null },
    });
    repositoryNodes.push(repoNode);

    const filePaths = walkFiles(repoAbs, profile.includeDirectories, [...DEFAULT_EXCLUDES, ...profile.excludeDirectories]);
    const modules = new Map();
    for (const rel of filePaths) {
      const fileType = classifyFileType(rel);
      const fileId = addNode(nodesById, {
        node_type: fileType === "document" ? "document" : fileType,
        repository: repoId,
        file: rel,
        path: rel,
        metadata: { source: "local-scan", repositoryPath: repoPath },
      });
      addEdge(edgesById, repoNode, fileId, "contains", {});

      const moduleName = rel.split("/")[0] || "root";
      if (!modules.has(moduleName)) {
        const moduleNode = addNode(nodesById, {
          node_type: "module",
          repository: repoId,
          path: `${repoId}/${moduleName}`,
          symbol: moduleName,
          title: moduleName,
          metadata: { repositoryPath: repoPath },
        });
        addEdge(edgesById, moduleNode, fileId, "contains", {});
        modules.set(moduleName, moduleNode);
      }

      const abs = path.join(repoAbs, rel);
      const content = safeText(abs);
      if (!content) continue;
      const imports = extractImports(content);
      for (const imp of imports) {
        const target = resolveImportTarget(repoAbs, rel, imp);
        if (!target) continue;
        const targetId = locateNodeByFile(nodesById, repoId, target);
        if (targetId) {
          addEdge(edgesById, fileId, targetId, "imports", { target: target });
        }
      }

      if (!isDocPath(rel)) {
        const symbols = extractSymbolRows(content);
        for (const symbol of symbols) {
          const symbolId = addNode(nodesById, {
            node_type: "symbol",
            repository: repoId,
            file: rel,
            symbol: symbol.symbol,
            path: rel,
            metadata: { line: symbol.line, kind: symbol.kind },
            tokens: estimateTokens(symbol.snippet),
          });
          addEdge(edgesById, fileId, symbolId, "contains", { symbolKind: "generic" });
          const concreteId = addNode(nodesById, {
            node_type: symbol.kind,
            repository: repoId,
            file: rel,
            symbol: symbol.symbol,
            path: rel,
            metadata: { line: symbol.line, snippet: symbol.snippet },
            tokens: estimateTokens(symbol.snippet),
          });
          addEdge(edgesById, symbolId, concreteId, "implements", { line: symbol.line });
          addEdge(edgesById, concreteId, fileId, "references", { kind: "contains" });
        }
      }

      if (isDocPath(rel) && (rel.toLowerCase().includes("architecture") || rel.toLowerCase().includes("decision"))) {
        const wikiId = addNode(nodesById, {
          node_type: "wiki_page",
          repository: repoId,
          file: rel,
          path: rel,
          symbol: rel,
          title: rel,
          metadata: { source: "repo-document" },
        });
        addEdge(edgesById, repoNode, wikiId, "documents", {});
      }
    }

    const architecture = collectArchitectureFiles(repoAbs);
    if (architecture) {
      const architectureId = addNode(nodesById, {
        node_type: "wiki_page",
        repository: repoId,
        file: architecture.file,
        path: architecture.file,
        title: architecture.title,
        content: architecture.content,
        tokens: estimateTokens(architecture.content),
        metadata: { source: "architecture-wiki.md" },
      });
      addEdge(edgesById, repoNode, architectureId, "documents", {});
    }
  }

  const tasks = collectTasks(root);
  const deps = collectDependencyMap(root);
  const decisions = collectDecisionRecords(root);
  const wiki = collectWikiRecords(root);
  const nexus = collectNexusRecords(root);
  const findings = collectStaticFindings(root);

  for (const task of tasks) {
    const taskId = `task:${task.id}`;
    const taskNode = addNode(nodesById, {
      node_type: "task",
      repository: task.repository || ".",
      task_id: task.id,
      title: task.title,
      content: `${task.title}\n${task.description || ""}`,
      metadata: { state: task.state, tags: task.tags },
    });
    if (task.repository) {
      const repoNode = makeRepositoryNodeId(task.repository);
      if (nodesById.has(repoNode)) {
        addEdge(edgesById, repoNode, taskNode, "belongs_to", {});
      }
    }
    for (const file of task.files) {
      const rel = toPosix(file);
      const modifiedNode = locateNodeByFile(nodesById, task.repository || ".", rel) ||
        locateNodeByFile(nodesById, ".", rel);
      if (modifiedNode) {
        addEdge(edgesById, taskNode, modifiedNode, "modifies", {});
      }
    }
    for (const decisionId of task.decisions) {
      const decision = addNode(nodesById, {
        node_type: "decision",
        repository: task.repository || ".",
        symbol: decisionId,
        title: decisionId,
        metadata: { source: "task-links" },
      });
      addEdge(edgesById, taskNode, decision, "documents", {});
    }
  }

  for (const dep of deps) {
    const from = `task:${dep.from}`;
    const to = `task:${dep.to}`;
    if (!nodesById.has(from)) {
      addNode(nodesById, { node_type: "task", repository: dep.repository || ".", task_id: dep.from, title: dep.from });
    }
    if (!nodesById.has(to)) {
      addNode(nodesById, { node_type: "task", repository: dep.repository || ".", task_id: dep.to, title: dep.to });
    }
    const depNode = addNode(nodesById, {
      node_type: "dependency",
      repository: dep.repository || ".",
      symbol: `${dep.from}->${dep.to}`,
      title: `${dep.from}->${dep.to}`,
      content: `${dep.from} ${dep.to} ${dep.type}`,
      metadata: { type: dep.type, file: dep.file || null },
      tokens: 1,
    });
    addEdge(edgesById, depNode, from, "depends_on", { direction: "to", relation: dep.type });
    addEdge(edgesById, depNode, to, "depends_on", { direction: "from", relation: dep.type });
  }

  for (const decision of decisions) {
    const decisionNode = addNode(nodesById, {
      node_type: "decision",
      repository: decision.repository || ".",
      symbol: decision.id,
      title: decision.title,
      content: decision.text,
      tokens: estimateTokens(decision.text),
      metadata: { source: "decision-log" },
    });
    if (decision.taskId) {
      const taskNode = `task:${decision.taskId}`;
      if (!nodesById.has(taskNode)) {
        addNode(nodesById, { node_type: "task", task_id: decision.taskId, repository: decision.repository || "." });
      }
      addEdge(edgesById, decisionNode, taskNode, "related_to", {});
    }
  }

  for (const page of wiki.pages) {
    const wikiNode = addNode(nodesById, {
      node_type: "wiki_page",
      repository: page.repository || ".",
      file: page.path,
      path: page.path,
      symbol: page.id,
      title: page.title,
      content: page.content,
      tokens: estimateTokens(page.content),
      metadata: { source: "git-wiki" },
    });
    if (page.taskId) {
      const taskNode = `task:${page.taskId}`;
      if (!nodesById.has(taskNode)) {
        addNode(nodesById, { node_type: "task", repository: page.repository || ".", task_id: page.taskId, title: page.taskId });
      }
      addEdge(edgesById, wikiNode, taskNode, "related_to", {});
    }
  }
  for (const decision of wiki.decisions) {
    const decisionNode = addNode(nodesById, {
      node_type: "decision",
      repository: decision.repository || ".",
      symbol: decision.id,
      title: decision.title,
      content: decision.text,
      metadata: { source: "git-wiki" },
      tokens: estimateTokens(decision.text),
    });
    if (decision.taskId) {
      const taskNode = `task:${decision.taskId}`;
      if (!nodesById.has(taskNode)) {
        addNode(nodesById, { node_type: "task", repository: decision.repository || ".", task_id: decision.taskId, title: decision.taskId });
      }
      addEdge(edgesById, decisionNode, taskNode, "related_to", {});
    }
  }

  for (const row of nexus.tasks) {
    const taskNode = `task:${row.id}`;
    if (!nodesById.has(taskNode)) {
      addNode(nodesById, { node_type: "task", task_id: row.id, repository: ".", title: row.id });
    }
    for (const issue of row.relatedIssues || []) {
      const relatedTask = `task:${String(issue).toUpperCase()}`;
      if (!nodesById.has(relatedTask)) {
        addNode(nodesById, { node_type: "task", task_id: String(issue).toUpperCase(), repository: ".", title: String(issue).toUpperCase() });
      }
      addEdge(edgesById, taskNode, relatedTask, "related_to", { source: "git-nexus" });
    }
    for (const pr of row.relatedPrs || []) {
      const prNode = addNode(nodesById, {
        node_type: "pull_request",
        repository: ".",
        symbol: `PR-${pr}`,
        metadata: { source: "git-nexus" },
      });
      addEdge(edgesById, prNode, taskNode, "related_to", {});
    }
    for (const chain of row.dependencyChains || []) {
      if (!Array.isArray(chain) || chain.length < 2) continue;
      const from = `task:${String(chain[0]).toUpperCase()}`;
      const to = `task:${String(chain[1]).toUpperCase()}`;
      if (!nodesById.has(from)) addNode(nodesById, { node_type: "task", task_id: String(chain[0]).toUpperCase(), repository: ".", title: String(chain[0]).toUpperCase() });
      if (!nodesById.has(to)) addNode(nodesById, { node_type: "task", task_id: String(chain[1]).toUpperCase(), repository: ".", title: String(chain[1]).toUpperCase() });
      addEdge(edgesById, from, to, "depends_on", { source: "git-nexus-chain" });
    }
    for (const blocked of row.blockedBy || []) {
      const from = `task:${String(blocked).toUpperCase()}`;
      if (!nodesById.has(from)) addNode(nodesById, { node_type: "task", task_id: String(blocked).toUpperCase(), repository: ".", title: String(blocked).toUpperCase() });
      addEdge(edgesById, from, taskNode, "blocks", { source: "git-nexus" });
    }
    for (const review of row.reviews || []) {
      const prNode = addNode(nodesById, {
        node_type: "pull_request",
        repository: ".",
        symbol: String(review || ""),
        metadata: { source: "git-nexus-review" },
      });
      addEdge(edgesById, prNode, taskNode, "reviews", {});
    }
  }

  for (const row of nexus.prs) {
    const prNode = addNode(nodesById, {
      node_type: "pull_request",
      repository: ".",
      symbol: `PR-${row.number}`,
      metadata: { source: "git-nexus-pr", number: row.number },
    });
    for (const taskId of row.relatedTasks || []) {
      const taskNode = `task:${String(taskId).toUpperCase()}`;
      if (!nodesById.has(taskNode)) {
        addNode(nodesById, { node_type: "task", repository: ".", task_id: String(taskId).toUpperCase() });
      }
      addEdge(edgesById, prNode, taskNode, "related_to", {});
    }
    for (const file of row.changedFiles || []) {
      const fileNode = locateNodeByFile(nodesById, ".", file) || locateNodeByFile(nodesById, row.repository || ".", file);
      if (fileNode) {
        addEdge(edgesById, prNode, fileNode, "modifies", { source: "git-nexus-pr" });
      }
    }
    for (const decision of row.decisions || []) {
      const decisionNode = addNode(nodesById, {
        node_type: "decision",
        repository: ".",
        symbol: decision,
        metadata: { source: "git-nexus-pr" },
      });
      addEdge(edgesById, prNode, decisionNode, "documents", {});
    }
  }

  for (const finding of findings) {
    const findingNode = addNode(nodesById, {
      node_type: "finding",
      repository: finding.repository || ".",
      symbol: finding.id || `${finding.rule || "finding"}:${finding.line || "0"}`,
      title: finding.rule || finding.id,
      content: `${finding.rule || ""} ${finding.message || ""}`.trim(),
      metadata: {
        severity: finding.severity,
        category: finding.category,
      },
      tokens: estimateTokens(`${finding.rule || ""} ${finding.message || ""} ${finding.recommendation || ""}`),
    });
    const targetRepoNode = makeRepositoryNodeId(finding.repository || ".");
    if (nodesById.has(targetRepoNode)) {
      addEdge(edgesById, findingNode, targetRepoNode, "belongs_to", { source: "analysis-results" });
    }
    if (finding.file && String(finding.file).trim()) {
      const fileNode = locateNodeByFile(nodesById, finding.repository || ".", finding.file);
      if (fileNode) {
        addEdge(edgesById, findingNode, fileNode, "references", {
          source: "static-analysis",
          line: finding.line || 0,
          rule: finding.rule || null,
        });
      }
    }
    if (finding.symbol) {
      const symbolNode = addNode(nodesById, {
        node_type: "symbol",
        repository: finding.repository || ".",
        file: finding.file || null,
        symbol: finding.symbol,
        title: finding.symbol,
        path: finding.file || null,
        metadata: { source: "static-analysis" },
      });
      addEdge(edgesById, findingNode, symbolNode, "references", { source: "static-analysis" });
    }
    if (finding.taskId) {
      const taskNode = `task:${finding.taskId}`;
      if (!nodesById.has(taskNode)) {
        addNode(nodesById, {
          node_type: "task",
          repository: finding.repository || ".",
          task_id: finding.taskId,
          title: finding.taskId,
        });
      }
      addEdge(edgesById, findingNode, taskNode, "related_to", { source: "static-analysis" });
    }
  }

  return {
    repositoryRoot: root,
    repositories: repos,
    nodes: [...nodesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edgesById.values()].sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`)),
    nodesById,
    edgesById,
    repoPathById,
  };

  function makeRepositoryNodeId(repoId) {
    return `repository:${makeSafeToken(repoId)}`;
  }
}

function runExternalGraphifyIfAvailable(root, outputPath, options = {}) {
  const binary = options.graphifyBinary || process.env.GRAPHIFY_BIN || "graphify";
  if (!commandExists(binary)) return { used: false };
  const attempts = [
    [binary, "build", "--root", root, "--out", outputPath],
    [binary, "generate", "--input", root, "--output", outputPath],
    [binary, "--input", root, "--output", outputPath],
  ];
  for (const attempt of attempts) {
    const result = childProcess.spawnSync(attempt[0], attempt.slice(1), {
      cwd: root,
      encoding: "utf8",
      stdio: "ignore",
    });
    if (result.status === 0 && fs.existsSync(outputPath)) {
      return { used: true, command: `${binary} ${attempt.slice(1).join(" ")}` };
    }
  }
  return { used: false };
}

function buildProjectGraph(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = normalizeProfile(profiles[options.profile] || profiles.coder || FALLBACK_PROFILES.coder);
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR));
  const graphFile = path.join(outputDir, options.outputFile || DEFAULT_GRAPH_FILE);

  if (options.preferExternal !== false) {
    const external = runExternalGraphifyIfAvailable(repositoryRoot, graphFile, {
      graphifyBinary: options.graphifyBinary,
    });
    if (external.used) {
      const graph = readJson(graphFile);
      if (graph) {
        graph.generated_at = graph.generated_at || new Date().toISOString();
        graph.profile = graph.profile || profile.name;
        return { ...graph, graphPath: graphFile, external: true, repositoryRoot, profile: profile.name };
      }
    }
  }

  const collected = collectGraphData(repositoryRoot, profile);
  const graph = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    profile: profile.name,
    repositories: collected.repositories.map((row) => row.id),
    root: repositoryRoot,
    nodes: collected.nodes,
    edges: collected.edges,
  };
  writeJson(graphFile, graph);
  return { ...graph, graphPath: graphFile, external: false, repositoryRoot, profile: profile.name };
}

function loadGraph(graphPath) {
  const graph = readJson(graphPath);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`Invalid graph format: ${graphPath}`);
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
  graph.edges.sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`));
  return graph;
}

function buildTaskGraph(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const taskId = String(options.taskId || options._taskId || "").toUpperCase();
  if (!taskId) throw new Error("buildTaskGraph requires task id");
  const profileName = options.profile || "coder";
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR));
  const baseGraph = buildProjectGraph({
    repositoryRoot,
    profile: profileName,
    outputDir,
    outputFile: options.outputFile || DEFAULT_GRAPH_FILE,
    preferExternal: options.preferExternal,
    forceFallback: options.forceFallback,
  });
  const graph = loadGraph(baseGraph.graphPath || baseGraph.outputPath || path.join(outputDir, DEFAULT_GRAPH_FILE));

  const targetIds = new Set([`task:${taskId}`]);
  for (const node of graph.nodes) {
    if (node?.node_type === "task" && String(node.task_id || "").toUpperCase() === taskId) {
      targetIds.add(node.id);
    }
  }
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }

  const includedNodes = new Set();
  const includedEdges = [];
  const queue = [...targetIds].map((nodeId) => ({ nodeId, depth: 0 }));
  const maxDepth = Number.isInteger(options.depth) ? options.depth : 2;

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift();
    if (!nodeId || includedNodes.has(nodeId) || depth > maxDepth) continue;
    const node = graph.nodes.find((row) => row.id === nodeId);
    if (!node) {
      continue;
    }
    includedNodes.add(nodeId);
    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      const edge = graph.edges.find((e) => (e.from === nodeId && e.to === neighbor) || (e.from === neighbor && e.to === nodeId));
      if (edge) {
        includedEdges.push(edge);
      }
      if (!includedNodes.has(neighbor)) queue.push({ nodeId: neighbor, depth: depth + 1 });
    }
  }

  if (![...includedNodes].some((id) => targetIds.has(id))) {
    const targetId = `task:${taskId}`;
    includedNodes.add(targetId);
    graph.nodes.push({
      id: targetId,
      node_type: "task",
      repository: ".",
      task_id: taskId,
      title: taskId,
      metadata: { source: "synthetic-task" },
    });
  }

  const outGraph = {
    version: graph.version || "1.0",
    generated_at: new Date().toISOString(),
    profile: graph.profile || profileName,
    task_id: taskId,
    root: repositoryRoot,
    nodes: graph.nodes.filter((row) => includedNodes.has(row.id)).sort((a, b) => a.id.localeCompare(b.id)),
    edges: includedEdges
      .filter((edge, index, all) => all.findIndex((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type) === index)
      .sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`)),
  };

  const taskGraphPath = path.join(outputDir, `${taskId}.graph.json`);
  writeJson(taskGraphPath, outGraph);

  const relatedTasks = [...new Set(
    outGraph.nodes
      .filter((row) => row.node_type === "task" && row.task_id && row.task_id.toUpperCase() !== taskId)
      .map((row) => row.task_id),
  )];
  const repositoryIds = [...new Set(outGraph.nodes.map((node) => node.repository).filter(Boolean))];
  const summaryPath = path.join(outputDir, `${taskId}.graph-summary.md`);
  const summaryLines = [
    `# ${taskId} Task Graph Summary`,
    "",
    `Repositories: ${repositoryIds.length > 0 ? repositoryIds.join(", ") : "unknown"}`,
    `Nodes: ${outGraph.nodes.length}`,
    `Edges: ${outGraph.edges.length}`,
    `Related tasks: ${relatedTasks.length > 0 ? relatedTasks.join(", ") : "none"}`,
    "",
  ];
  fs.writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");

  return {
    repositoryRoot,
    profile: profileName,
    taskId,
    graphPath: taskGraphPath,
    summaryPath,
    graph: outGraph,
    repositories: repositoryIds,
    nodeCount: outGraph.nodes.length,
    edgeCount: outGraph.edges.length,
  };
}

function queryProjectGraph(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const outDir = path.resolve(options.outputDir || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR));
  const graphPath = path.resolve(options.graphPath || path.join(outDir, options.graphFile || DEFAULT_GRAPH_FILE));
  const profileName = options.profile || "coder";
  const query = String(options.query || options.q || "").trim().toLowerCase();
  const requestedTask = String(options.taskId || "").toUpperCase();
  const repositoryFilter = options.repository || options.repositoryFilter;
  const limit = Number.isInteger(Number(options.limit)) ? Number(options.limit) : 25;

  const profile = normalizeProfile(loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH)[profileName] || FALLBACK_PROFILES[profileName]);
  const graph = loadGraph(graphPath);
  const priorityMap = new Map(profile.prioritize.map((kind, idx) => [kind, profile.prioritize.length - idx]));
  const neighborsByNode = new Map();

  for (const edge of graph.edges) {
    if (!neighborsByNode.has(edge.from)) neighborsByNode.set(edge.from, []);
    if (!neighborsByNode.has(edge.to)) neighborsByNode.set(edge.to, []);
    neighborsByNode.get(edge.from).push({ node_id: edge.to, edge_type: edge.type });
    neighborsByNode.get(edge.to).push({ node_id: edge.from, edge_type: edge.type });
  }

  const qTokens = new Set(tokenize(query));
  const rows = [];
  for (const node of graph.nodes) {
    if (repositoryFilter && String(node.repository || "").toLowerCase() !== String(repositoryFilter).toLowerCase()) {
      continue;
    }
    if (requestedTask && node.node_type === "task" && node.task_id !== requestedTask) {
      continue;
    }

    const haystack = [
      node.id,
      node.repository,
      node.file,
      node.symbol,
      node.title,
      node.path,
      node.task_id,
      JSON.stringify(node.metadata || {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const nodeTokens = new Set(tokenize(haystack));
    const overlap = [...qTokens].filter((tok) => nodeTokens.has(tok)).length;
    let score = qTokens.size ? overlap / Math.max(qTokens.size, 1) : 0;
    if (query && (node.id.toLowerCase() === query || (node.file || "").toLowerCase() === query)) score += 0.35;
    if (query && qTokens.size && node.id.toLowerCase().includes(query)) score += 0.25;
    if (query && /\bmc-\d+\b/.test(query) && node.node_type === "task" && node.task_id === query.toUpperCase()) score += 1;
    score += (priorityMap.get(node.node_type) || 0) * 0.05;
    if (query && node.repository && query.includes(node.repository.toLowerCase())) score += 0.2;

    if (query && score <= 0) continue;
    if (!query && node.node_type === "repository") score = 0.001;

    rows.push({
      node_id: node.id,
      node_type: node.node_type,
      repository: node.repository || null,
      file: node.file || null,
      symbol: node.symbol || node.title || null,
      score: parseFloat(Math.min(1, score).toFixed(5)),
      reason: node.node_type === "task" ? "task match" : "query match",
      neighbors: (neighborsByNode.get(node.id) || []).slice(0, profile.max_neighbors || 5),
    });
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.node_id).localeCompare(String(b.node_id));
  });

  return {
    query,
    profile: profileName,
    task_id: requestedTask || null,
    results: rows.slice(0, limit),
    total: rows.length,
    graph: {
      generated_at: graph.generated_at,
      profile: graph.profile,
      repositories: graph.repositories || [],
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    },
  };
}

function computeDegrees(nodes, edges) {
  const scores = new Map();
  for (const node of nodes) scores.set(node.id, 0);
  for (const edge of edges) {
    if (scores.has(edge.from)) scores.set(edge.from, (scores.get(edge.from) || 0) + 1);
    if (scores.has(edge.to)) scores.set(edge.to, (scores.get(edge.to) || 0) + 1);
  }
  return scores;
}

function exportGraphContext(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, "generated-context"));
  const graphPath = path.resolve(
    options.graphPath || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR, options.graphFile || DEFAULT_GRAPH_FILE),
  );
  const profile = normalizeProfile(loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH)[options.profile || "coder"] || FALLBACK_PROFILES.coder);
  const taskId = String(options.taskId || "").toUpperCase();

  const graph = loadGraph(graphPath);
  const nodeMap = new Map(graph.nodes.map((row) => [row.id, row]));
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }

  let targetNodes = new Set(graph.nodes.map((row) => row.id));
  if (taskId) {
    targetNodes = new Set();
    const focused = queryProjectGraph({
      repositoryRoot,
      graphPath,
      query: taskId,
      profile: profile.name,
      taskId,
      limit: 200,
    }).results;
    const queue = [];
    for (const row of focused.filter((r) => r.node_type === "task" || r.node_type === "file")) {
      if (row.node_id) queue.push(row.node_id);
    }
    while (queue.length) {
      const id = queue.shift();
      if (targetNodes.has(id)) continue;
      if (!nodeMap.has(id)) continue;
      targetNodes.add(id);
      for (const neighbor of adjacency.get(id) || []) {
        queue.push(neighbor);
      }
    }
  }

  const nodes = graph.nodes.filter((row) => targetNodes.has(row.id));
  const edges = graph.edges.filter((edge) => targetNodes.has(edge.from) && targetNodes.has(edge.to));
  const byType = new Map();
  for (const row of nodes) {
    if (!byType.has(row.node_type)) byType.set(row.node_type, []);
    byType.get(row.node_type).push(row);
  }

  const degree = computeDegrees(nodes, edges);
  const topFiles = nodes
    .filter((row) => ["file", "test", "document"].includes(row.node_type))
    .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.id.localeCompare(b.id))
    .slice(0, Math.max(6, profile.max_neighbors * 2));

  const relatedSymbols = nodes
    .filter((row) => ["symbol", "function", "class", "interface"].includes(row.node_type))
    .map((row) => ({
      node_id: row.id,
      symbol: row.symbol || row.title || row.file,
      file: row.file || "",
      repository: row.repository || null,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const riskyModules = nodes
    .filter((row) => row.node_type === "module")
    .map((row) => ({ ...row, degree: degree.get(row.id) || 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, Math.max(5, profile.max_neighbors));

  const affectedDependencies = edges
    .filter((row) => row.type === "depends_on")
    .map((row) => `${row.from}->${row.to}`)
    .slice(0, 30);

  const relevantDecisions = nodes
    .filter((row) => row.node_type === "decision")
    .map((row) => row.symbol || row.title || row.id);
  const relatedWiki = nodes
    .filter((row) => row.node_type === "wiki_page")
    .map((row) => ({ node_id: row.id, file: row.file || "", repository: row.repository || null }));
  const relatedTasks = nodes.filter((row) => row.node_type === "task").map((row) => row.task_id || row.symbol || row.id);

  const context = {
    generated_at: new Date().toISOString(),
    profile: profile.name,
    source_graph: graphPath,
    task_id: taskId || null,
    repositories: [...new Set(nodes.map((row) => row.repository).filter(Boolean))],
    high_centrality_files: topFiles.map((row) => ({
      node_id: row.id,
      file: row.file || row.path || row.id,
      repository: row.repository || null,
      score: degree.get(row.id) || 0,
    })),
    related_symbols: relatedSymbols,
    risky_modules: riskyModules.map((row) => ({ node_id: row.id, symbol: row.symbol || row.path || row.id, degree: row.degree })),
    affected_dependencies: affectedDependencies,
    relevant_decisions: [...new Set(relevantDecisions)],
    relevant_wiki_pages: relatedWiki,
    related_tasks: [...new Set(relatedTasks)],
    centrality: Object.fromEntries([...degree.entries()].sort((a, b) => b[1] - a[1])),
    file_count: nodes.filter((row) => row.node_type === "file").length,
    edge_count: edges.length,
  };

  const md = [];
  md.push(`# Graph Context`);
  md.push(`Profile: ${context.profile}`);
  md.push(`Generated at: ${context.generated_at}`);
  if (taskId) md.push(`Task: ${taskId}`);
  md.push(`Repositories: ${context.repositories.join(", ") || "unknown"}`);
  md.push("");
  md.push(`File count: ${context.file_count}`);
  md.push(`Edge count: ${context.edge_count}`);
  md.push("");
  md.push("## High-centrality files");
  for (const item of context.high_centrality_files) {
    md.push(`- ${item.file} (${item.repository || "unknown"}) score=${item.score}`);
  }
  md.push("");
  md.push("## Related symbols");
  for (const item of context.related_symbols.slice(0, Math.max(10, profile.max_neighbors * 2))) {
    md.push(`- ${item.symbol} @ ${item.file}`);
  }
  md.push("");
  md.push("## Risky modules");
  for (const item of context.risky_modules) {
    md.push(`- ${item.symbol} (${item.degree})`);
  }
  md.push("");
  md.push("## Affected dependencies");
  for (const dep of context.affected_dependencies) {
    md.push(`- ${dep}`);
  }
  md.push("");
  md.push("## Relevant decisions");
  for (const row of context.relevant_decisions) {
    md.push(`- ${row}`);
  }
  md.push("");
  md.push("## Related wiki pages");
  for (const page of context.relevant_wiki_pages) {
    md.push(`- ${page.file} (${page.repository || "unknown"})`);
  }
  md.push("");
  md.push("## Related tasks");
  for (const row of context.related_tasks) {
    md.push(`- ${row}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const contextMdPath = path.join(outputDir, DEFAULT_GRAPH_CONTEXT_MD);
  const contextJsonPath = path.join(outputDir, DEFAULT_GRAPH_CONTEXT_JSON);
  fs.writeFileSync(contextJsonPath, JSON.stringify(context, null, 2), "utf8");
  fs.writeFileSync(contextMdPath, `${md.join("\n")}\n`, "utf8");

  return {
    repositoryRoot,
    graphPath,
    graphContextJsonPath: contextJsonPath,
    graphContextMdPath: contextMdPath,
    context,
  };
}

function summarizeGraph(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR));
  const graphPath = path.resolve(outputDir, options.graphFile || DEFAULT_GRAPH_FILE);
  const graph = loadGraph(options.graphPath || graphPath);
  const summaryPath = path.resolve(options.outputDir || repositoryRoot, options.summaryPath || DEFAULT_SUMMARY_FILE);

  const byRepo = new Map();
  for (const node of graph.nodes) {
    const key = node.repository || "";
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(node);
  }
  const adjacency = new Map();
  const dependsOn = new Map();
  for (const edge of graph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
    if (edge.type === "depends_on") {
      if (!dependsOn.has(edge.from)) dependsOn.set(edge.from, []);
      dependsOn.get(edge.from).push(edge.to);
    }
  }

  const clusters = [];
  const seen = new Set();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const cluster = [];
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length) {
      const current = queue.shift();
      const currentNode = graph.nodes.find((row) => row.id === current);
      if (currentNode) cluster.push(currentNode);
      for (const next of adjacency.get(current) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    clusters.push(cluster.sort((a, b) => a.id.localeCompare(b.id)));
  }

  const degree = computeDegrees(graph.nodes, graph.edges);
  const highCentrality = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(5, Math.round(graph.nodes.length * 0.1)))
    .map(([node_id, score]) => ({ node_id, score }));
  const maxScore = highCentrality.length ? highCentrality[0].score : 0;
  const isolatedModules = graph.nodes
    .filter((row) => ["module", "file", "document", "task", "decision"].includes(row.node_type) && (degree.get(row.id) || 0) === 0)
    .slice(0, 30)
    .map((row) => row.id);

  const godNodes = highCentrality
    .filter((row) => row.score >= Math.max(3, Math.floor(maxScore * 0.8)))
    .map((row) => `${row.node_id} (${row.score})`)
    .slice(0, 20);

  const crossRepoLinks = [];
  for (const edge of graph.edges) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    if ((from.repository || "") && (to.repository || "") && from.repository !== to.repository) {
      crossRepoLinks.push(`${from.repository} -> ${to.repository}: ${edge.from} ${edge.type} ${edge.to}`);
    }
  }
  const taskHotspots = [...new Set(
    graph.edges
      .filter((edge) => edge.type === "depends_on")
      .map((edge) => `${edge.from}->${edge.to}`),
  )].slice(0, 60);

  const lines = [];
  lines.push("# Project Graph Summary");
  lines.push(`Generated: ${graph.generated_at || new Date().toISOString()}`);
  lines.push(`Profile: ${graph.profile || "coder"}`);
  lines.push("");
  lines.push("## Repository clusters");
  for (const [repository, nodes] of byRepo.entries()) {
    lines.push(`- ${repository || "global"}: ${nodes.length}`);
  }
  lines.push("");
  lines.push("## Important modules");
  for (const row of highCentrality) {
    lines.push(`- ${row.node_id} (${row.score})`);
  }
  lines.push("");
  lines.push("## High-centrality files");
  for (const row of highCentrality.filter((item) => {
    const node = graph.nodes.find((candidate) => candidate.id === item.node_id);
    return node && node.node_type === "file";
  })) {
    lines.push(`- ${row.node_id} (${row.score})`);
  }
  lines.push("");
  lines.push("## Isolated modules");
  for (const row of isolatedModules) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## Possible god nodes");
  for (const row of godNodes) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## Cross-repo links");
  for (const row of [...new Set(crossRepoLinks)]) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## Task dependency hotspots");
  for (const row of taskHotspots) lines.push(`- ${row}`);

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");

  return {
    summaryPath,
    payload: {
      repositories: [...byRepo.entries()].map(([repository, nodes]) => ({ repository, node_count: nodes.length })),
      high_centrality: highCentrality,
      isolated_modules: isolatedModules,
      god_nodes: godNodes,
      cross_repository_links: [...new Set(crossRepoLinks)],
      task_dependency_hotspots: taskHotspots,
    },
    clusters: clusters.map((cluster) => cluster.map((row) => row.id)),
  };
}

function detectDependencyCycles(graph) {
  const adjacency = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== "depends_on") continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const pushCycle = (node, next) => {
    const cycle = [...stack, next];
    const text = cycle.join(" -> ");
    if (!cycles.includes(text)) cycles.push(text);
  };
  function dfs(node) {
    if (visiting.has(node)) {
      pushCycle(node, node);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) || []) {
      dfs(next);
    }
    stack.pop();
    visiting.delete(node);
  }
  for (const node of adjacency.keys()) {
    dfs(node);
  }
  return cycles;
}

function validateGraph(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, DEFAULT_OUTPUT_DIR));
  const graphPath = path.resolve(options.graphPath || path.join(outputDir, options.graphFile || DEFAULT_GRAPH_FILE));
  const graph = loadGraph(graphPath);
  const failures = [];
  const seenIds = new Set();
  const repoNodes = new Set();
  const repositoryPaths = new Map();
  const fileIndex = new Map();

  for (const node of graph.nodes) {
    if (!node || !node.id) {
      failures.push("missing node id");
      continue;
    }
    if (seenIds.has(node.id)) {
      failures.push(`duplicate node id: ${node.id}`);
    }
    seenIds.add(node.id);

    if (!VALID_NODE_TYPES.has(node.node_type)) {
      failures.push(`invalid node type: ${node.node_type}`);
    }

    if (node.node_type === "repository") {
      repoNodes.add(node.id);
      repositoryPaths.set(node.repository || node.id.replace(/^repository:/, ""), toPosix(node.path || "."));
    }
    if (!node.repository && node.node_type !== "repository") {
      failures.push(`missing repository on node: ${node.id}`);
    }
    if (["file", "test", "document"].includes(node.node_type) && node.repository && node.file) {
      const key = `${node.repository}:${toPosix(node.file)}`;
      fileIndex.set(key, (fileIndex.get(key) || 0) + 1);
      const repositoryPath = repositoryPaths.get(node.repository) || node.repository || ".";
      const abs = path.resolve(repositoryRoot, repositoryPath, node.file);
      if (!fs.existsSync(abs)) {
        failures.push(`missing file node on disk: ${node.repository}/${node.file}`);
      }
    }
  }
  for (const node of graph.nodes) {
    const repositoryKnown = node.repository === "." || repoNodes.has(`repository:${node.repository}`);
    if (node.repository && !repositoryKnown && node.node_type !== "repository" && node.node_type !== "file") {
      failures.push(`unknown repository for node: ${node.id}`);
    }
  }
  for (const [key, count] of fileIndex.entries()) {
    if (count > 1) {
      failures.push(`duplicate file node for repository path: ${key}`);
    }
  }

  const nodeIds = new Set(graph.nodes.map((row) => row.id));
  for (const edge of graph.edges) {
    if (!VALID_EDGE_TYPES.has(edge.type)) {
      failures.push(`invalid edge type: ${edge.type}`);
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      failures.push(`dangling edge: ${edge.from} ${edge.type} ${edge.to}`);
    }
  }

  const cycles = detectDependencyCycles(graph);
  for (const cycle of cycles) {
    failures.push(`dependency cycle detected: ${cycle}`);
  }

  return {
    valid: failures.length === 0,
    failures,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    graphPath,
  };
}

function validate(options = {}) {
  return validateGraph(options);
}

function generateGraphifyConfig(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const profileName = options.profile || "coder";
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = normalizeProfile(profiles[profileName] || FALLBACK_PROFILES.coder);
  const repos = readRepoRegistry(repositoryRoot).map((row) => toPosix(row.path));
  const gitignore = loadGitignore(repositoryRoot);
  const template = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
  const outputPath = path.resolve(repositoryRoot, "graphify.config.json");
  const output = template
    .replaceAll("{{REPOSITORY_PATHS}}", JSON.stringify(repos))
    .replaceAll("{{INCLUDE_PATTERNS}}", JSON.stringify(profile.includeDirectories))
    .replaceAll("{{IGNORE_PATTERNS}}", JSON.stringify([...new Set([...profile.excludeDirectories, ...gitignore])]))
    .replaceAll("{{OUTPUT_FILE}}", JSON.stringify(path.join(repositoryRoot, DEFAULT_OUTPUT_DIR, DEFAULT_GRAPH_FILE)));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
  return { configPath: outputPath };
}

module.exports = {
  loadProfiles,
  buildProjectGraph,
  buildTaskGraph,
  queryProjectGraph,
  exportGraphContext,
  summarizeGraph,
  validateGraph,
  validate,
  generateGraphifyConfig,
};
