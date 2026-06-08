const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "semantic-config.json");
const DEFAULT_PROFILES_PATH = path.join(__dirname, "..", "embedding-profiles.json");
const DEFAULT_INDEX_FILE = "semantic-index.json";

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

const SOURCE_TO_DIR = {
  code_symbols: "code-symbols",
  tests: "code-symbols",
  docs: "docs",
  tasks: "tasks",
  decisions: "decisions",
  dependencies: "dependencies",
  findings: "findings",
  reviews: "reviews",
  graph_summaries: "graphs",
};
const DEFAULT_SOURCE_TYPES = Object.keys(SOURCE_TO_DIR);
const SECRET_PATTERNS = [
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_+\-.\/]{6,}['"]?/gi,
  /(?:password|api[_-]?secret)\s*[:=]\s*['"]?[A-Za-z0-9_+\-.\/]{4,}['"]?/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
];

function toIso() {
  return new Date().toISOString();
}

function stableId(...parts) {
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(value || ""), "utf8");
}

function readTextSafe(filePath, maxBytes = 200000) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) return null;
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("\u0000")) return null;
  return raw;
}

function signaturesEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[bKeys[index]]);
}

function tokenize(input) {
  return String(input || "").toLowerCase().match(/[a-z0-9_.$]+/g) || [];
}

function overlap(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  left.forEach((token) => {
    if (right.has(token)) hits += 1;
  });
  return hits / Math.max(left.size, right.size);
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(a[i] || 0);
    const y = Number(b[i] || 0);
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function snippetFor(text, query, limit = 260) {
  const source = String(text || "");
  const q = String(query || "").toLowerCase();
  const low = source.toLowerCase();
  if (q && low.includes(q)) {
    const start = Math.max(0, low.indexOf(q) - 100);
    return source.slice(start, start + limit).replace(/\s+/g, " ").trim();
  }
  return source.slice(0, limit).replace(/\s+/g, " ").trim();
}

function redactSecrets(value) {
  const cfg = loadConfig();
  if (cfg.redaction?.enabled === false) return String(value || "");
  let out = String(value || "");
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, cfg.redaction.mask || "[redacted]");
  }
  return out;
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readJson(configPath) || {};
  return {
    paths: {
      indexRoot: raw.paths?.indexRoot || "generated-semantic-index",
      indexFile: raw.paths?.indexFile || DEFAULT_INDEX_FILE,
    },
    integrationFiles: {
      globalIssues: raw.integrationFiles?.globalIssues || "global-issues.json",
      dependencyMap: raw.integrationFiles?.dependencyMap || "dependency-map.json",
      decisionLog: raw.integrationFiles?.decisionLog || "decision-log.json",
      architectureWiki: raw.integrationFiles?.architectureWiki || "architecture-wiki.md",
      gitWiki: raw.integrationFiles?.gitWiki || "git-wiki.json",
      findingResults: raw.integrationFiles?.findingResults || "analysis-results/findings.json",
      reviewSummaries: raw.integrationFiles?.reviewSummaries || "analysis-results/summary.json",
      repoRegistry: raw.integrationFiles?.repoRegistry || "repo-registry.json",
      graphSummary: raw.integrationFiles?.graphSummary || path.join("generated-graphs", "project-graph-summary.md"),
      graphJson: raw.integrationFiles?.graphJson || path.join("generated-graphs", "project-graph.json"),
      gitNexus: raw.integrationFiles?.gitNexus || "git-nexus.json",
    },
    indexing: {
      skipDirectories: raw.indexing?.skipDirectories || [".git", ".github", "node_modules", "dist", "build", ".turbo", ".next", "coverage"],
      codeExtensions: raw.indexing?.codeExtensions || [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".cs", ".cpp", ".c", ".h", ".hpp", ".cc", ".rb", ".php", ".rs", ".kt", ".swift"],
      docExtensions: raw.indexing?.docExtensions || [".md", ".rst", ".txt", ".yaml", ".yml", ".toml", ".json"],
      maxFileBytes: Number(raw.indexing?.maxFileBytes || 200000),
      includeTestFiles: raw.indexing?.includeTestFiles !== false,
    },
    ranking: {
      exactSymbolBoost: Number(raw.ranking?.exactSymbolBoost || 0.9),
      taskRelevanceBoost: Number(raw.ranking?.taskRelevanceBoost || 0.35),
      dependencyRelevanceBoost: Number(raw.ranking?.dependencyRelevanceBoost || 0.2),
      documentationDecay: Number(raw.ranking?.documentationDecay || 0.08),
      recentDecisionBoost: Number(raw.ranking?.recentDecisionBoost || 0.15),
      reviewerFindingBoost: Number(raw.ranking?.reviewerFindingBoost || 0.18),
    },
    embeddings: {
      provider: raw.embeddings?.provider || "local",
      dimension: Number(raw.embeddings?.dimension || 64),
    },
    qdrant: {
      enabled: raw.qdrant?.enabled || false,
      collection: raw.qdrant?.collection || "mission-control-semantic",
      host: raw.qdrant?.host || "http://127.0.0.1:6333",
      apiKeyEnv: raw.qdrant?.apiKeyEnv || "QDRANT_API_KEY",
    },
    redaction: {
      enabled: raw.redaction?.enabled !== false,
      mask: raw.redaction?.mask || "[redacted]",
    },
  };
}

function loadProfiles(profilePath = DEFAULT_PROFILES_PATH) {
  const raw = readJson(profilePath) || {};
  const supplied = raw.profiles || {};
  const normalized = {};
  for (const [name, row] of Object.entries(supplied)) {
    normalized[name] = {
      name,
      sources: Array.isArray(row.sources) && row.sources.length > 0 ? row.sources : DEFAULT_SOURCE_TYPES,
      top_k: Number.isFinite(Number(row.top_k)) ? Number(row.top_k) : 12,
    };
  }
  return {
    architect: normalized.architect || { name: "architect", sources: ["docs", "decisions", "tasks", "dependencies", "graph_summaries"], top_k: 12 },
    coder: normalized.coder || { name: "coder", sources: ["code_symbols", "tests", "docs", "findings", "tasks"], top_k: 16 },
    reviewer: normalized.reviewer || { name: "reviewer", sources: ["code_symbols", "findings", "reviews", "tasks", "decisions"], top_k: 16 },
    maintainer: normalized.maintainer || { name: "maintainer", sources: ["tasks", "decisions", "reviews", "dependencies", "findings"], top_k: 12 },
    ...normalized,
  };
}

function fileSignature(filePath) {
  const stat = fs.statSync(filePath);
  return stableId(filePath, stat.size, stat.mtimeMs);
}

function walkFiles(root, cfg, relBase = ".") {
  const base = path.resolve(root, relBase);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const skip = new Set((cfg.indexing.skipDirectories || []).map((entry) => normalizePath(entry).replace(/^\/+|\/+$/g, "")));
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(base, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const segments = childRel.split("/").map((p) => p);
      if (segments.some((seg) => skip.has(seg))) continue;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (!cfg.indexing.includeTestFiles && /(?:^|[\\/_])(?:test|spec)\b/i.test(entry.name)) continue;
      out.push({
        relativePath: normalizePath(childRel),
        absolutePath: childAbs,
        ext: path.extname(entry.name).toLowerCase(),
      });
    }
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function mapTaskFiles(root, cfg) {
  const payload = readJson(path.join(root, cfg.integrationFiles.globalIssues)) || {};
  const mapping = new Map();
  for (const task of Array.isArray(payload.tasks) ? payload.tasks : []) {
    const id = String(task.id || "").toUpperCase();
    for (const rel of Array.isArray(task.files) ? task.files : []) {
      const norm = normalizePath(rel);
      mapping.set(norm, id);
      mapping.set(norm.replace(/^\/+/, ""), id);
    }
  }
  return mapping;
}

function normalizeRepositoryEntries(root) {
  const payload = readJson(path.join(root, "repo-registry.json")) || {};
  const raw = payload.repositories || {};
  if (Array.isArray(raw)) {
    return raw.map((row) => ({
      id: String(row.id || row.name || row.path || "."),
      path: String(row.path || row.id || row.name || "."),
    }));
  }
  const entries = Object.entries(raw || {});
  if (entries.length > 0) {
    return entries.map(([id, row]) => ({
      id,
      path: String((row && typeof row === "object" && row.path) || row || id),
    }));
  }
  return [{ id: ".", path: "." }];
}

function isTestFile(relativePath, fileName) {
  const normalized = String(relativePath || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  return (
    /(?:^|[\\/])(test|spec)\b/.test(normalized) ||
    /\.(test|spec)\./.test(name) ||
    /\.test$|\.spec$/.test(name) ||
    /_test\./.test(name) ||
    /_spec\./.test(name)
  );
}

function parseCodeRows(repository, relPath, content, taskId) {
  const rows = [];
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    /(?:export\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:export\s+)?async\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:export\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ];
  let found = false;
  for (let i = 1; i <= lines.length; i += 1) {
    const line = lines[i - 1] || "";
    for (const re of patterns) {
      const regex = new RegExp(re.source, re.flags);
      let match = null;
      while ((match = regex.exec(line)) !== null) {
        found = true;
        rows.push({
          id: stableId("symbol", repository, relPath, match[1], i),
          source_type: "code_symbols",
          repository,
          path: relPath,
          symbol: match[1],
          task_id: taskId || "",
          title: match[1],
          text: line.trim(),
          metadata: { kind: "symbol", line: i },
          source_file: relPath,
        });
      }
    }
  }
  if (!found) {
    rows.push({
      id: stableId("module", repository, relPath),
      source_type: "code_symbols",
      repository,
      path: relPath,
      symbol: path.basename(relPath),
      task_id: taskId || "",
      title: `${path.basename(relPath)} module`,
      text: String(content || "").slice(0, 2200),
      metadata: { kind: "module" },
      source_file: relPath,
    });
  }
  return rows;
}

function collectSourceRows(root, cfg) {
  const records = [];
  const signatures = {};
  const repos = normalizeRepositoryEntries(root);
  const taskMap = mapTaskFiles(root, cfg);

  for (const repo of repos) {
    const files = walkFiles(root, cfg, repo.path);
    for (const file of files) {
      if (fs.statSync(file.absolutePath).size > cfg.indexing.maxFileBytes) continue;
      const content = readTextSafe(file.absolutePath, cfg.indexing.maxFileBytes);
      if (content === null) continue;
      const taskId = taskMap.get(file.relativePath) || taskMap.get(file.relativePath.replace(/^\/+/, "")) || "";
      const repository = repo.id || ".";
      signatures[`${repository}/${file.relativePath}`] = fileSignature(file.absolutePath);
      if (cfg.indexing.codeExtensions.includes(file.ext)) {
        const sourceType = isTestFile(file.relativePath, file.relativePath) ? "tests" : "code_symbols";
        records.push(...parseCodeRows(repository, file.relativePath, content, taskId).map((row) => ({
          ...row,
          source_type: sourceType,
        })));
      } else if (cfg.indexing.docExtensions.includes(file.ext)) {
        records.push({
          id: stableId("doc", repository, file.relativePath),
          source_type: "docs",
          repository,
          path: file.relativePath,
          symbol: path.basename(file.relativePath),
          task_id: taskId,
          title: path.basename(file.relativePath),
          text: redactSecrets(content.slice(0, 5000)),
          metadata: { kind: "doc", size: content.length },
          source_file: file.relativePath,
        });
      }
    }
  }
  return { rows: records, signatures };
}

function collectTaskRows(root, cfg) {
  const payload = readJson(path.join(root, cfg.integrationFiles.globalIssues)) || {};
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const rows = [];
  const signatures = {};
  for (const task of tasks) {
    const id = String(task.id || "").toUpperCase();
    if (!id) continue;
    rows.push({
      id: stableId("task", id),
      source_type: "tasks",
      repository: task.repository || task.repo || ".",
      path: cfg.integrationFiles.globalIssues,
      symbol: id,
      task_id: id,
      title: task.title || id,
      text: redactSecrets(`${id}\n${task.title || ""}\n${task.description || ""}`),
      metadata: { state: task.state || "open", files: task.files || [] },
      source_file: cfg.integrationFiles.globalIssues,
    });
  }
  if (tasks.length) signatures[cfg.integrationFiles.globalIssues] = stableId(cfg.integrationFiles.globalIssues, JSON.stringify(tasks));
  return { rows, signatures };
}

function collectDecisionRows(root, cfg) {
  const rows = [];
  const signatures = {};
  const seen = new Set();
  const arch = readTextSafe(path.join(root, cfg.integrationFiles.architectureWiki), 120000);
  if (arch) {
    const id = stableId("decision", cfg.integrationFiles.architectureWiki);
    seen.add(id);
    rows.push({
      id,
      source_type: "decisions",
      repository: ".",
      path: cfg.integrationFiles.architectureWiki,
      symbol: "architecture-wiki",
      task_id: "",
      title: "architecture-wiki",
      text: redactSecrets(arch.slice(0, 5000)),
      metadata: { createdAt: toIso(), source: "architecture" },
      source_file: cfg.integrationFiles.architectureWiki,
    });
    signatures[cfg.integrationFiles.architectureWiki] = stableId(cfg.integrationFiles.architectureWiki, arch);
  }
  const decisionLog = readJson(path.join(root, cfg.integrationFiles.decisionLog)) || {};
  for (const row of Array.isArray(decisionLog.decisions) ? decisionLog.decisions : []) {
    const symbol = String(row.id || row.title || "decision");
    const key = stableId("decision", symbol, row.taskId || row.task_id || "");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: key,
      source_type: "decisions",
      repository: row.repository || row.repo || ".",
      path: cfg.integrationFiles.decisionLog,
      symbol,
      task_id: String(row.taskId || row.task_id || "").toUpperCase(),
      title: row.title || symbol,
      text: redactSecrets(`${symbol}\n${row.text || row.description || ""}`),
      metadata: { createdAt: row.createdAt || row.updatedAt || toIso() },
      source_file: cfg.integrationFiles.decisionLog,
    });
  }
  if (Array.isArray(decisionLog.decisions)) signatures[cfg.integrationFiles.decisionLog] = stableId(cfg.integrationFiles.decisionLog, JSON.stringify(decisionLog.decisions));

  const wiki = readJson(path.join(root, cfg.integrationFiles.gitWiki));
  if (Array.isArray(wiki?.pages)) {
    for (const row of wiki.pages) {
      const symbol = String(row.id || row.path || row.title || "wiki-page");
      const id = stableId("decision", "wiki", symbol);
      rows.push({
        id,
        source_type: "decisions",
        repository: row.repository || row.repo || ".",
        path: row.path || row.id || symbol,
        symbol,
        task_id: String(row.taskId || row.task_id || "").toUpperCase(),
        title: row.title || symbol,
        text: redactSecrets(`${symbol}\n${row.summary || ""}\n${row.content || ""}`),
        metadata: { source: "git-wiki", related: row.related || [] },
        source_file: cfg.integrationFiles.gitWiki,
      });
    }
    signatures[cfg.integrationFiles.gitWiki] = stableId(cfg.integrationFiles.gitWiki, JSON.stringify(wiki.pages));
  }
  return { rows, signatures };
}

function collectDependencyRows(root, cfg) {
  const dep = readJson(path.join(root, cfg.integrationFiles.dependencyMap)) || {};
  const rows = [];
  const signatures = {};
  const edges = Array.isArray(dep.dependencies) ? dep.dependencies : [];
  for (const row of edges) {
    const from = String(row.from || "").toUpperCase();
    const to = String(row.to || "").toUpperCase();
    if (!from || !to) continue;
    rows.push({
      id: stableId("dep", from, to, row.type || "depends_on"),
      source_type: "dependencies",
      repository: row.repository || ".",
      path: cfg.integrationFiles.dependencyMap,
      symbol: row.type || "depends_on",
      task_id: from,
      title: `${from}->${to}`,
      text: redactSecrets(`${from} ${row.type || "depends_on"} ${to}`),
      metadata: { from, to, type: row.type || "depends_on" },
      source_file: cfg.integrationFiles.dependencyMap,
    });
  }
  if (edges.length) signatures[cfg.integrationFiles.dependencyMap] = stableId(cfg.integrationFiles.dependencyMap, JSON.stringify(edges));
  return { rows, signatures };
}

function collectFindingRows(root, cfg) {
  const payload = readJson(path.join(root, cfg.integrationFiles.findingResults)) || {};
  const rows = [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const signatures = {};
  for (const row of findings) {
    rows.push({
      id: stableId("finding", row.id || row.rule || row.file || "", row.line || 0),
      source_type: "findings",
      repository: row.repository || ".",
      path: row.file || "",
      symbol: row.rule || row.id || "finding",
      task_id: String(row.taskId || row.task_id || "").toUpperCase(),
      title: row.rule || row.id || "finding",
      text: redactSecrets(`${row.message || ""}\n${row.recommendation || ""}`),
      metadata: {
        severity: String(row.severity || "info").toLowerCase(),
        category: row.category || "general",
        line: row.line || 0,
      },
      source_file: cfg.integrationFiles.findingResults,
    });
  }
  if (findings.length) signatures[cfg.integrationFiles.findingResults] = stableId(cfg.integrationFiles.findingResults, JSON.stringify(findings));
  return { rows, signatures };
}

function collectReviewRows(root, cfg) {
  const rows = [];
  const signatures = {};
  const summaryPath = path.join(root, "analysis-results", "review-summary.md");
  const reviewSummary = readTextSafe(summaryPath, 120000);
  if (reviewSummary) {
    rows.push({
      id: stableId("review", "summary"),
      source_type: "reviews",
      repository: ".",
      path: "analysis-results/review-summary.md",
      symbol: "review-summary",
      task_id: "",
      title: "review summary",
      text: redactSecrets(reviewSummary),
      metadata: { source: "review-summary" },
      source_file: "analysis-results/review-summary.md",
    });
    signatures["analysis-results/review-summary.md"] = stableId("review-summary", reviewSummary);
  }
  const findings = readJson(path.join(root, "analysis-results", "review-findings.json"));
  const items = Array.isArray(findings?.findings) ? findings.findings : [];
  for (const row of items) {
    rows.push({
      id: stableId("review", row.id || row.rule || row.file || ""),
      source_type: "reviews",
      repository: row.repository || ".",
      path: row.file || "",
      symbol: row.rule || row.id || "finding",
      task_id: String(row.taskId || row.task_id || "").toUpperCase(),
      title: row.id || row.rule || "finding",
      text: redactSecrets(`${row.message || ""}\n${row.recommendation || ""}`),
      metadata: { severity: String(row.severity || "info").toLowerCase(), category: row.category || "review" },
      source_file: "analysis-results/review-findings.json",
    });
  }
  if (items.length) signatures["analysis-results/review-findings.json"] = stableId("review-findings", JSON.stringify(items));
  return { rows, signatures };
}

function collectGraphRows(root, cfg) {
  const rows = [];
  const signatures = {};
  const summary = readTextSafe(path.join(root, cfg.integrationFiles.graphSummary), 120000);
  if (summary) {
    rows.push({
      id: stableId("graph", "summary"),
      source_type: "graph_summaries",
      repository: ".",
      path: cfg.integrationFiles.graphSummary,
      symbol: "project-graph-summary",
      task_id: "",
      title: "project graph summary",
      text: redactSecrets(summary),
      metadata: { source: "graph-summary" },
      source_file: cfg.integrationFiles.graphSummary,
    });
    signatures[cfg.integrationFiles.graphSummary] = stableId(cfg.integrationFiles.graphSummary, summary);
  }
  const graph = readJson(path.join(root, cfg.integrationFiles.graphJson));
  if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
    const top = graph.nodes.slice(0, 80).map((node) => `${node.id}:${node.type}`).join("\n");
    rows.push({
      id: stableId("graph", "project"),
      source_type: "graph_summaries",
      repository: ".",
      path: cfg.integrationFiles.graphJson,
      symbol: "project-graph",
      task_id: "",
      title: "project graph",
      text: redactSecrets(top),
      metadata: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
      source_file: cfg.integrationFiles.graphJson,
    });
    signatures[cfg.integrationFiles.graphJson] = stableId("project-graph", graph.nodes.length, graph.edges.length);
  }
  return { rows, signatures };
}

function collectAllRecords(root, cfg) {
  const sources = [
    collectSourceRows(root, cfg),
    collectTaskRows(root, cfg),
    collectDecisionRows(root, cfg),
    collectDependencyRows(root, cfg),
    collectFindingRows(root, cfg),
    collectReviewRows(root, cfg),
    collectGraphRows(root, cfg),
  ];
  const signatures = {};
  const records = [];
  for (const bucket of sources) {
    for (const row of bucket.rows) records.push(row);
    Object.assign(signatures, bucket.signatures);
  }
  return { records, signatures };
}

function loadEmbeddingProvider(cfg) {
  const name = cfg.embeddings?.provider || "local";
  const providerPath = path.join(__dirname, "providers", "embeddings", `${name}.js`);
  try {
    const providerModule = fs.existsSync(providerPath) ? require(providerPath) : null;
    if (providerModule && typeof providerModule.createProvider === "function") {
      return providerModule.createProvider(cfg.embeddings);
    }
  } catch {
    // ignore and fall back
  }
  return require(path.join(__dirname, "providers", "embeddings", "local.js")).createProvider(cfg.embeddings);
}

function loadQdrantProvider(cfg) {
  if (!cfg.qdrant?.enabled) return { enabled: false };
  const providerPath = path.join(__dirname, "providers", "qdrant", "index.js");
  try {
    const moduleProvider = require(providerPath);
    if (typeof moduleProvider.createProvider === "function") {
      return moduleProvider.createProvider(cfg.qdrant);
    }
  } catch {
    return { enabled: false };
  }
  return { enabled: false };
}

function withVectors(records, cfg) {
  const provider = loadEmbeddingProvider(cfg);
  const dimension = cfg.embeddings.dimension || 64;
  return records.map((row) => ({
    ...row,
    vector: provider.embedText(redactSecrets(row.text || ""), dimension),
    vector_provider: provider.name || "local",
    vector_dimension: dimension,
  }));
}

function writeSourceIndex(indexRoot, type, fileName, rows) {
  const dir = path.join(indexRoot, SOURCE_TO_DIR[type] || type);
  writeJson(path.join(dir, fileName), {
    source_type: type,
    generated_at: toIso(),
    count: rows.length,
    records: rows,
  });
}

function loadGraphify() {
  const candidate = path.resolve(__dirname, "..", "..", "graphify", "src", "engine.js");
  if (!fs.existsSync(candidate)) return null;
  try {
    return require(candidate);
  } catch {
    return null;
  }
}

function loadCodeSearch() {
  const candidate = path.resolve(__dirname, "..", "..", "code-search", "src", "engine.js");
  if (!fs.existsSync(candidate)) return null;
  try {
    return require(candidate);
  } catch {
    return null;
  }
}

function buildSemanticIndex(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const outputRoot = path.resolve(options.outputDir || options.indexRoot || path.join(repositoryRoot, cfg.paths.indexRoot));
  const fileName = options.indexFile || cfg.paths.indexFile || DEFAULT_INDEX_FILE;
  const profileName = options.profile || "coder";
  const gathered = collectAllRecords(repositoryRoot, cfg);
  const records = withVectors(gathered.records, cfg);

  const byType = {};
  for (const row of records) {
    if (!byType[row.source_type]) byType[row.source_type] = [];
    byType[row.source_type].push(row);
  }
  for (const type of DEFAULT_SOURCE_TYPES) {
    writeSourceIndex(outputRoot, type, fileName, byType[type] || []);
  }

  const manifest = {
    generated_at: toIso(),
    repository_root: repositoryRoot,
    profile: profileName,
    source_signatures: gathered.signatures,
    records,
    source_types: DEFAULT_SOURCE_TYPES,
    count: records.length,
  };

  const qdrant = loadQdrantProvider(cfg);
  if (qdrant?.enabled && typeof qdrant.rebuild === "function") {
    qdrant.rebuild({ collection: cfg.qdrant.collection, records });
    manifest.vector_enabled = true;
    manifest.vector_name = qdrant.name || "qdrant";
  } else {
    manifest.vector_enabled = false;
    manifest.vector_name = "local";
  }

  writeJson(path.join(outputRoot, fileName), manifest);
  return {
    indexPath: path.join(outputRoot, fileName),
    indexRoot: outputRoot,
    recordCount: records.length,
    vectorEnabled: manifest.vector_enabled,
  };
}

function updateSemanticIndex(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const outputRoot = path.resolve(options.outputDir || options.indexRoot || path.join(repositoryRoot, cfg.paths.indexRoot));
  const fileName = options.indexFile || cfg.paths.indexFile;
  const next = collectAllRecords(repositoryRoot, cfg);
  const current = readJson(path.join(outputRoot, fileName));
  if (current && signaturesEqual(current.source_signatures || {}, next.signatures)) {
    return {
      unchanged: true,
      indexPath: path.join(outputRoot, fileName),
      indexRoot: outputRoot,
      recordCount: (current.records || []).length,
    };
  }
  const build = buildSemanticIndex({ ...options, outputRoot, indexFile: fileName, repositoryRoot });
  return { ...build, unchanged: false };
}

function loadIndex(indexRoot, indexFile, explicitPath) {
  const filePath = explicitPath || path.join(indexRoot, indexFile || DEFAULT_INDEX_FILE);
  const payload = readJson(filePath);
  if (!payload) throw new Error(`Missing semantic index at ${filePath}`);
  return payload;
}

function scoreForRow(row, query, cfg, profile, taskFilter, repositoryFilter) {
  const q = String(query || "").trim();
  const qLower = q.toLowerCase();
  const exactSymbol = String(row.symbol || "").toLowerCase() === qLower;
  const taskMatch = taskFilter && String(row.task_id || "").toUpperCase() === taskFilter;
  const repoMatch = repositoryFilter && normalizePath(row.repository || "") === normalizePath(repositoryFilter);
  const lexical = (overlap(row.title, q) * 0.4) + (overlap(row.text, q) * 0.6);
  const semantic = row.vector ? cosine(row.vector, loadEmbeddingProvider(cfg).embedText(redactSecrets(q), row.vector_dimension || cfg.embeddings.dimension)) : 0;
  let score = (semantic * 0.65) + (lexical * 0.3);
  if (exactSymbol) score += cfg.ranking.exactSymbolBoost;
  if (taskMatch) score += cfg.ranking.taskRelevanceBoost;
  if (row.source_type === "dependencies") score += cfg.ranking.dependencyRelevanceBoost;
  if (row.source_type === "decisions") score += cfg.ranking.recentDecisionBoost;
  if (repoMatch) score += 0.05;
  if (profile === "reviewer" && row.source_type === "findings") {
    const severity = String(row.metadata?.severity || "info").toLowerCase();
    if (severity === "critical" || severity === "high") score += cfg.ranking.reviewerFindingBoost;
  }
  if (row.source_type === "docs" || row.source_type === "decisions") score -= cfg.ranking.documentationDecay;
  if (score < 0) score = 0;
  return Number(Math.min(1, score).toFixed(4));
}

function semanticSearch(options = {}) {
  const query = String(options.query || "").trim();
  if (!query) throw new Error("semantic-search requires a query");
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[options.profile || "coder"] || profiles.coder;
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const indexRoot = path.resolve(options.indexRoot || options.outputDir || path.join(repositoryRoot, cfg.paths.indexRoot));
  const indexFile = options.indexFile || cfg.paths.indexFile || DEFAULT_INDEX_FILE;
  const index = loadIndex(indexRoot, indexFile);
  const repoFilter = String(options.repository || "").trim();
  const taskFilter = String(options.taskId || "").toUpperCase();

  const sourceFilter = new Set(profile.sources || []);
  const results = [];
  for (const row of Array.isArray(index.records) ? index.records : []) {
    if (sourceFilter.size > 0 && !sourceFilter.has(row.source_type)) continue;
    if (repoFilter && normalizePath(row.repository || "") !== normalizePath(repoFilter)) continue;
    if (taskFilter && row.task_id && row.task_id.toUpperCase() !== taskFilter && row.source_type !== "tasks") continue;
    const score = scoreForRow(row, query, cfg, profile.name, taskFilter, repoFilter);
    if (!score) continue;
    results.push({
      id: row.id,
      score,
      source_type: row.source_type,
      repository: row.repository,
      path: row.path,
      symbol: row.symbol,
      task_id: row.task_id,
      snippet: snippetFor(redactSecrets(row.text || ""), query),
      reason: String(row.symbol || "").toLowerCase() === query.toLowerCase() ? "exact symbol match" : "semantic similarity",
      source: "semantic-retrieval",
    });
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    query,
    profile: profile.name,
    results: results.slice(0, profile.top_k || 12),
    total: results.length,
    mode: index.vector_enabled ? "qdrant" : "local",
  };
}

function toHybridResult(row, profileName) {
  const exact = String(row.symbol || "").toLowerCase() === String(row.query || "").toLowerCase();
  const sourceSymbolMatch = row.source_type === "code_symbols";
  const taskRel = row.task_id ? 0.4 : 0;
  const depRel = row.source_type === "dependencies" ? 0.8 : 0;
  const ownershipRel = row.owner || 0;
  const rankScore = Number((row.score * 0.55 + (exact ? 0.4 : 0) + taskRel + depRel + ownershipRel).toFixed(4));
  return {
    ...row,
    symbolRelevance: sourceSymbolMatch ? row.score : 0,
    taskRelevance: taskRel,
    dependencyRelevance: depRel,
    ownershipRelevance: ownershipRel,
    semanticRelevance: row.score,
    documentationRelevance: (row.source_type === "docs" || row.source_type === "decisions" || row.source_type === "graph_summaries") ? row.score : 0,
    rankScore,
    score: rankScore,
    reason: row.reason || "hybrid score",
  };
}

function resolveCodeSearch(query, options = {}) {
  const engine = loadCodeSearch();
  if (!engine || typeof engine.searchSymbol !== "function") return [];
  try {
    const rows = engine.searchSymbol({ repositoryRoot: options.repositoryRoot, symbolName: query, limit: options.limit || 20, preferSourcebot: true, repository: options.repository }).results || [];
    return rows.map((row) => ({
      id: stableId("symbols", row.repository || "", row.file || "", row.symbol || ""),
      score: Number(row.score || 0.95),
      source_type: "code_symbols",
      repository: row.repository,
      path: row.file,
      symbol: row.symbol,
      task_id: "",
      snippet: row.snippet || "",
      reason: "exact symbol match from code-search",
      source: "code-search",
      query,
    }));
  } catch {
    return [];
  }
}

function resolveGraphMatches(query, options = {}) {
  const graphEngine = loadGraphify();
  if (!graphEngine || typeof graphEngine.queryProjectGraph !== "function") return [];
  try {
    const rows = graphEngine.queryProjectGraph({
      repositoryRoot: options.repositoryRoot,
      query,
      repository: options.repository,
      profile: options.profile || "coder",
      taskId: options.taskId,
      limit: options.limit || 20,
    }).results || [];
    return rows.map((row) => ({
      id: row.node_id || stableId("graph", row.repository || "", row.symbol || ""),
      score: Number(row.score || 0.7),
      source_type: "graph",
      repository: row.repository,
      path: row.file || row.node_id || "",
      symbol: row.symbol || row.node_id || "",
      task_id: "",
      snippet: row.reason || "",
      reason: "graph neighborhood",
      source: "graphify",
      query,
    }));
  } catch {
    return [];
  }
}

function resolveDependencyAndNexus(query, cfg, repositoryRoot, options = {}) {
  const q = String(query || "").toUpperCase();
  const out = [];
  const dep = readJson(path.join(repositoryRoot, cfg.integrationFiles.dependencyMap)) || {};
  for (const row of Array.isArray(dep.dependencies) ? dep.dependencies : []) {
    const from = String(row.from || "").toUpperCase();
    const to = String(row.to || "").toUpperCase();
    if (from === q || to === q) {
      out.push({
        id: stableId("dep", from, to),
        score: 0.8,
        source_type: "dependencies",
        repository: row.repository || ".",
        path: cfg.integrationFiles.dependencyMap,
        symbol: row.type || "depends_on",
        task_id: from,
        snippet: `${from} -> ${to}`,
        reason: "dependency relationship",
        source: "dependency-map",
        query,
      });
    }
  }
  const nexus = readJson(path.join(repositoryRoot, cfg.integrationFiles.gitNexus));
  for (const row of Array.isArray(nexus?.tasks) ? nexus.tasks : []) {
    const id = String(row.id || "").toUpperCase();
    if (id !== q) continue;
    for (const linked of Array.isArray(row.relatedTasks) ? row.relatedTasks : []) {
      out.push({
        id: stableId("nexus", id, linked),
        score: 0.65,
        source_type: "tasks",
        repository: ".",
        path: cfg.integrationFiles.globalIssues,
        symbol: linked,
        task_id: String(linked).toUpperCase(),
        snippet: `${id} linked to ${linked}`,
        reason: "git-nexus link",
        source: "git-nexus",
        query,
      });
    }
  }
  return out;
}

function hybridSemanticSearch(options = {}) {
  const query = String(options.query || "").trim();
  if (!query) throw new Error("hybrid-semantic-search requires a query");
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[options.profile || "coder"] || profiles.coder;
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : (profile.top_k || 12);
  const idx = path.resolve(options.indexRoot || options.outputDir || path.join(repositoryRoot, cfg.paths.indexRoot));

  const semantic = semanticSearch({
    query,
    profile: profile.name,
    repositoryRoot,
    indexRoot: idx,
    indexFile: options.indexFile,
    repository: options.repository,
    taskId: options.taskId,
    limit: Math.max(5, Math.ceil(limit / 2)),
  }).results.map((row) => ({ ...row, query }));

  const code = resolveCodeSearch(query, { repositoryRoot, repository: options.repository, limit: Math.max(3, Math.ceil(limit / 3)) });
  const graph = resolveGraphMatches(query, { repositoryRoot, repository: options.repository, profile: profile.name, taskId: options.taskId, limit: Math.max(3, Math.ceil(limit / 3)) });
  const dep = resolveDependencyAndNexus(query, cfg, repositoryRoot, { profile: profile.name });

  const merged = [...semantic, ...code, ...graph, ...dep].map((row) => toHybridResult(row, profile.name));
  const dedup = new Map();
  for (const row of merged) {
    const key = `${row.source_type}|${row.repository}|${row.path}|${row.symbol}`;
    if (!dedup.has(key) || dedup.get(key).rankScore < row.rankScore) dedup.set(key, row);
  }
  const ranked = Array.from(dedup.values()).sort((a, b) => b.rankScore - a.rankScore || a.path.localeCompare(b.path));
  return {
    query,
    profile: profile.name,
    results: ranked.slice(0, limit),
    total: ranked.length,
    mode: "hybrid",
  };
}

function validateSemanticIndex(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const indexRoot = path.resolve(options.indexRoot || options.outputDir || path.join(repositoryRoot, cfg.paths.indexRoot));
  const index = readJson(path.join(indexRoot, options.indexFile || cfg.paths.indexFile || DEFAULT_INDEX_FILE));
  const failures = [];
  if (!index) return { valid: false, failures: ["missing index"], indexRoot };
  const ids = new Set();
  const byPath = new Set();
  for (const row of Array.isArray(index.records) ? index.records : []) {
    if (!row.id) failures.push("record without id");
    if (ids.has(row.id)) failures.push(`duplicate id ${row.id}`);
    ids.add(row.id);
    const key = `${row.source_type}|${row.path}`;
    if (byPath.has(key)) failures.push(`duplicate path source ${key}`);
    byPath.add(key);
  }
  if (index.count !== undefined && index.count !== index.records.length) {
    failures.push("count mismatch");
  }
  return {
    valid: failures.length === 0,
    failures,
    recordCount: ids.size,
    indexRoot,
  };
}

function exportSemanticContext(options = {}) {
  const query = String(options.query || "").trim();
  if (!query) throw new Error("export-semantic-context requires a query");
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[options.profile || "coder"] || profiles.coder;
  const outDir = path.resolve(options.outputDir || path.join(repositoryRoot, "generated-context"));
  const search = hybridSemanticSearch({
    query,
    profile: profile.name,
    repositoryRoot,
    repository: options.repository,
    taskId: options.taskId,
    indexRoot: options.indexRoot || options.outputDir || path.join(repositoryRoot, cfg.paths.indexRoot),
    indexFile: options.indexFile,
    limit: profile.top_k || 12,
  });

  const lines = [];
  lines.push("# Semantic Context");
  lines.push(`Profile: ${profile.name}`);
  lines.push(`Query: ${query}`);
  lines.push("");
  lines.push("## Selected matches");
  for (const row of search.results) {
    lines.push(`- [${row.source_type}] ${row.repository || "global"}:${row.path || ""} (${row.symbol || ""})`);
    lines.push(`  - score: ${row.score}`);
    lines.push(`  - reason: ${row.reason}`);
    if (row.snippet) lines.push(`  - snippet: ${row.snippet.slice(0, 140)}`);
  }
  if (search.results.length === 0) lines.push("- no matches");

  const mdPath = path.join(outDir, "semantic-context.md");
  const jsonPath = path.join(outDir, "semantic-context.json");
  writeText(mdPath, `${lines.join("\n")}\n`);
  writeJson(jsonPath, {
    generated_at: toIso(),
    query,
    profile: profile.name,
    repository: options.repository || "",
    task_id: options.taskId || "",
    results: search.results,
  });
  return { mdPath, jsonPath, results: search.results };
}

function compareRetrievalModes(options = {}) {
  const query = String(options.query || "").trim();
  if (!query) throw new Error("compare-retrieval-modes requires a query");
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[options.profile || "coder"] || profiles.coder;
  const indexRoot = path.resolve(options.indexRoot || path.join(repositoryRoot, cfg.paths.indexRoot));
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : (profile.top_k || 12);

  const code = resolveCodeSearch(query, { repositoryRoot, limit });
  const semantic = semanticSearch({ query, profile: profile.name, repositoryRoot, indexRoot, limit });
  const graph = resolveGraphMatches(query, { repositoryRoot, profile: profile.name, limit });
  const hybrid = hybridSemanticSearch({ query, profile: profile.name, repositoryRoot, indexRoot, limit });

  const cset = new Set(code.map((row) => row.id));
  const sset = new Set(semantic.results.map((row) => row.id));
  const gset = new Set(graph.map((row) => row.id));
  const hset = new Set(hybrid.results.map((row) => row.id));
  const overlapCodeSemantic = [...semantic.results].filter((row) => cset.has(row.id)).length;
  const overlapCodeGraph = [...graph].filter((row) => cset.has(row.id)).length;
  const overlapHybrid = [...semantic.results, ...code, ...graph]
    .filter((row) => hset.has(row.id))
    .length;

  const outDir = path.resolve(options.outputDir || path.join(repositoryRoot, "generated-context"));
  const mdPath = path.join(outDir, "retrieval-comparison.md");
  const jsonPath = path.join(outDir, "retrieval-comparison.json");
  const lines = [];
  lines.push("# Retrieval Comparison");
  lines.push(`Query: ${query}`);
  lines.push(`Profile: ${profile.name}`);
  lines.push("");
  lines.push(`- code search: ${code.length}`);
  lines.push(`- semantic: ${semantic.results.length}`);
  lines.push(`- graph: ${graph.length}`);
  lines.push(`- hybrid: ${hybrid.results.length}`);
  lines.push(`- overlap code+semantic: ${overlapCodeSemantic}`);
  lines.push(`- overlap code+graph: ${overlapCodeGraph}`);
  lines.push(`- overlap in hybrid: ${overlapHybrid}`);
  lines.push("");
  lines.push(`Recommended: ${hybrid.results.length >= Math.max(code.length, semantic.results.length, graph.length) ? "hybrid" : "semantic"}`);
  writeText(mdPath, `${lines.join("\n")}\n`);
  writeJson(jsonPath, {
    query,
    profile: profile.name,
    counts: {
      code: code.length,
      semantic: semantic.results.length,
      graph: graph.length,
      hybrid: hybrid.results.length,
      overlapCodeSemantic,
      overlapCodeGraph,
      overlapHybrid,
    },
  });
  return {
    mdPath,
    jsonPath,
    counts: {
      code: code.length,
      semantic: semantic.results.length,
      graph: graph.length,
      hybrid: hybrid.results.length,
      overlapCodeSemantic,
      overlapCodeGraph,
      overlapHybrid,
    },
  };
}

module.exports = {
  loadConfig,
  loadProfiles,
  collectAllRecords,
  buildSemanticIndex,
  updateSemanticIndex,
  semanticSearch,
  hybridSemanticSearch,
  validateSemanticIndex,
  exportSemanticContext,
  compareRetrievalModes,
  redactSecrets,
};
