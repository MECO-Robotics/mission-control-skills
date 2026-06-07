const fs = require("fs");
const path = require("path");

const DEFAULT_SEARCH_CONFIG_PATH = path.join(__dirname, "..", "search-config.json");
const DEFAULT_PROFILES_PATH = path.join(__dirname, "..", "retrieval-profiles.json");
const INDEX_ROOT = path.join(__dirname, "..", "indexes");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listLines(content) {
  return content.split(/\r\n|\r|\n/);
}

function isBinaryPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const binaryExts = new Set([
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
  return binaryExts.has(ext);
}

function loadSearchConfig(configPath = DEFAULT_SEARCH_CONFIG_PATH) {
  const cfg = readJson(configPath);
  if (!cfg) {
    throw new Error(`Search config missing: ${configPath}`);
  }
  const profile = readJson(DEFAULT_PROFILES_PATH)?.profiles || {};
  return {
    ...cfg,
    profiles: profile,
  };
}

function loadProfiles(profilePath = DEFAULT_PROFILES_PATH) {
  const cfg = readJson(profilePath);
  return (cfg && cfg.profiles) || {};
}

function normalizeProfile(raw) {
  return {
    name: raw?.name || "coder",
    includeDirectories: raw?.include?.directories || [],
    includeFiles: raw?.include?.files || [],
    excludeDirectories: raw?.exclude?.directories || [],
    resultLimit: raw?.resultLimit || 50,
    includeDocs: raw?.documentation?.include !== false,
    includeTests: raw?.tests?.include !== false,
    priorities: raw?.priorities || [],
  };
}

function loadRepoRegistry(root) {
  const data = readJson(path.join(root, "repo-registry.json")) || {};
  const repos = data.repositories || {};
  const out = [];
  if (repos && typeof repos === "object" && !Array.isArray(repos) && Object.keys(repos).length > 0) {
    for (const [id, cfg] of Object.entries(repos)) {
      out.push({
        id,
        path: String(cfg?.path || id),
        owner: cfg?.owner || null,
      });
    }
  } else if (Array.isArray(repos)) {
    for (const row of repos) {
      out.push({
        id: String(row.id || row.name || row.path || "repo"),
        path: String(row.path || row.id || row.name || ""),
        owner: row.owner || null,
      });
    }
  }
  if (out.length === 0) {
    out.push({ id: ".", path: ".", owner: null });
  }
  return out;
}

function fileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.mtimeMs}:${stat.size}`;
}

function walkFiles(rootAbs, filters = {}) {
  const files = [];
  const excludeDirs = new Set(
    [...(filters.excludeDirectories || [])].map((d) => d.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")),
  );
  const stack = ["."];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(rootAbs, rel);
    const dirents = fs.readdirSync(abs, { withFileTypes: true });
    for (const item of dirents) {
      const childRel = rel === "." ? item.name : `${rel}/${item.name}`;
      const childAbs = path.join(rootAbs, childRel);
      const normRel = childRel.replace(/\\/g, "/");
      const normDir = normRel.split("/");
      if (item.isDirectory()) {
        if (excludeDirs.has(normRel) || normDir.some((segment) => excludeDirs.has(segment))) {
          continue;
        }
        stack.push(normRel);
        continue;
      }
      if (!item.isFile()) {
        continue;
      }
      if (isBinaryPath(childAbs)) {
        continue;
      }
      files.push(childAbs);
    }
  }
  files.sort();
  return files;
}

function readTextSafe(filePath) {
  const data = fs.readFileSync(filePath, "utf8");
  if (data.includes("\u0000")) {
    return null;
  }
  return data;
}

function tokenizeForSearch(input) {
  const normalized = String(input || "").toLowerCase();
  const parts = normalized.match(/[a-z0-9_]+/g) || [];
  return parts;
}

function tokenizeCamel(text) {
  const tokens = [];
  for (const token of tokenizeForSearch(text)) {
    const chunks = token.split(/(?=[A-Z])|_/);
    for (const chunk of chunks) {
      const lower = chunk.toLowerCase();
      if (lower.length > 1) tokens.push(lower);
    }
  }
  return tokens;
}

function tokenSet(text) {
  const t = new Set();
  for (const tok of tokenizeForSearch(text)) {
    t.add(tok);
  }
  for (const camel of tokenizeCamel(text)) {
    t.add(camel);
  }
  return t;
}

function overlapScore(queryTokens, targetTokens) {
  if (queryTokens.size === 0 || targetTokens.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const tok of queryTokens) {
    if (targetTokens.has(tok)) {
      shared += 1;
    }
  }
  const union = new Set([...queryTokens, ...targetTokens]);
  return shared / union.size;
}

function exactMatchScore(query, target) {
  const q = String(query || "").toLowerCase();
  const t = String(target || "").toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 1;
  if (t.includes(q)) return 0.5;
  return 0;
}

function snippetFrom(content, term, window = 4) {
  if (!content) return "";
  const lines = listLines(content);
  const lowered = content.toLowerCase();
  const needle = String(term || "").toLowerCase();
  const index = lowered.indexOf(needle);
  if (index < 0) {
    return lines.slice(0, Math.min(lines.length, 6)).join("\n");
  }
  const upTo = content.slice(0, index);
  const lineNo = upTo.split(/\n/).length - 1;
  const from = Math.max(0, lineNo - window);
  const to = Math.min(lines.length, lineNo + window + 1);
  return lines.slice(from, to).join("\n");
}

function sha1(content) {
  const crypto = require("crypto");
  return crypto.createHash("sha1").update(content).digest("hex");
}

function classifyFile(filePath) {
  const lower = filePath.toLowerCase();
  if (
    lower.endsWith(".md")
    || lower.endsWith(".rst")
    || lower.endsWith(".txt")
    || lower.endsWith(".yaml")
    || lower.endsWith(".yml")
    || lower.endsWith(".toml")
    || lower.endsWith(".json")
  ) {
    return "docs";
  }
  return "code";
}

function repoPathFor(root, repoRel) {
  return path.resolve(root, repoRel || ".");
}

function collectSourceEntries(repositoryRoot, filters = {}) {
  const repos = loadRepoRegistry(repositoryRoot);
  const sourceConfig = loadSearchConfig();
  const excludeDirectories = new Set([...(sourceConfig.index.excludeDirectories || []), ...(filters.excludeDirectories || [])]);
  const result = [];
  const seen = new Set();
  for (const repo of repos) {
    const repoAbs = repoPathFor(repositoryRoot, repo.path);
    if (!fs.existsSync(repoAbs)) {
      continue;
    }
    const files = walkFiles(repoAbs, { excludeDirectories: [...excludeDirectories, ".gitignore"] });
    for (const fileAbs of files) {
      const rel = path.relative(repoAbs, fileAbs).split(path.sep).join("/");
      if (seen.has(fileAbs)) {
        continue;
      }
      seen.add(fileAbs);
      const content = readTextSafe(fileAbs);
      if (content === null) continue;
      const textTokens = tokenizeForSearch(content);
      result.push({
        repositoryId: repo.id,
        repositoryPath: repo.path,
        repositoryOwner: repo.owner || null,
        absolutePath: fileAbs,
        relativePath: `${repo.path.replace(/\\//g, "/")}/${rel}`.replace(/^\.\/|^\//, ""),
        fileName: path.basename(fileAbs),
        extension: path.extname(fileAbs).toLowerCase(),
        kind: classifyFile(fileAbs),
        size: fs.statSync(fileAbs).size,
        tokens: textTokens,
        tokenSet: tokenSet(content),
        snippet: snippetFrom(content, textTokens[0] || rel),
        content,
      });
    }
  }
  return result;
}

function extractSymbolCandidates(text, repository, filePath) {
  const lines = listLines(text);
  const symbols = [];

  const specs = [
    { kind: "function", re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "class", re: /(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "interface", re: /(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "type", re: /(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "module", re: /(?:export\s+)?namespace\s+([A-Za-z_$][A-Za-z0-9_$]*)/g },
    { kind: "api", re: /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/g },
    { kind: "configuration_object", re: /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*config|[A-Z_][A-Za-z0-9_]*)\s*=\s*\{/gi },
  ];

  for (const spec of specs) {
    const regex = new RegExp(spec.re.source, spec.re.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const token = match[1];
      if (!token) continue;
      const before = text.slice(0, match.index);
      const lineNo = before.split(/\n/).length;
      symbols.push({
        symbol: token,
        kind: spec.kind,
        repository,
        file: filePath,
        line: lineNo,
        code: (lines[Math.max(0, lineNo - 1)] || "").trim(),
      });
    }
  }
  return symbols;
}

function collectTaskRecords(repositoryRoot) {
  const source = readJson(path.join(repositoryRoot, "global-issues.json"));
  const tasks = [];
  const rows = source?.tasks || [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const id = String(row.id || row.taskId || "").toUpperCase();
    if (!id) continue;
    tasks.push({
      id,
      title: String(row.title || ""),
      description: String(row.description || ""),
      repository: row.repository || row.repo || null,
      state: row.state || "open",
      decisions: Array.isArray(row.decisions) ? row.decisions : [],
      files: Array.isArray(row.files) ? row.files : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      metadata: row,
    });
  }
  return tasks;
}

function collectDependencyRecords(repositoryRoot) {
  const direct = readJson(path.join(repositoryRoot, "dependency-map.json")) || {};
  const rows = Array.isArray(direct.dependencies) ? direct.dependencies : [];
  const edges = rows
    .map((row) => ({
      from: String(row.from || "").toUpperCase(),
      to: String(row.to || "").toUpperCase(),
      type: row.type || "depends_on",
      repository: row.repository || row.repo || null,
      metadata: row,
    }))
    .filter((row) => row.from && row.to);

  const nexus = readJson(path.join(repositoryRoot, "git-nexus.json")) || {};
  const nexusRows = [];
  if (Array.isArray(nexus.tasks)) {
    for (const row of nexus.tasks) {
      const id = String(row.id || row.taskId || "").toUpperCase();
      if (!id) continue;
      if (Array.isArray(row.dependencyChains)) {
        for (const chain of row.dependencyChains) {
          if (Array.isArray(chain) && chain.length >= 2) {
            nexusRows.push({
              from: id,
              to: String(chain[1]).toUpperCase(),
              type: "nexus_dependency",
              repository: row.repository || null,
              metadata: { ...row, dependencyChain: chain },
            });
          }
        }
      }
      if (Array.isArray(row.relatedTasks)) {
        for (const related of row.relatedTasks) {
          if (!related) continue;
          nexusRows.push({
            from: id,
            to: String(related).toUpperCase(),
            type: "nexus_related",
            repository: row.repository || null,
            metadata: { ...row, related },
          });
        }
      }
    }
  }

  return [...edges, ...nexusRows];
}

function collectWikiRecords(repositoryRoot) {
  const wiki = readJson(path.join(repositoryRoot, "git-wiki.json"));
  const pages = [];
  if (wiki && Array.isArray(wiki.pages)) {
    for (const p of wiki.pages) {
      pages.push({
        id: p.id || p.slug || p.title || "wiki-page",
        title: p.title || p.id || "wiki page",
        content: String(p.content || ""),
        path: p.path || p.slug || "",
        repository: p.repository || p.repo || null,
        related: Array.isArray(p.related) ? p.related : [],
      });
    }
  }

  const decisionLog = readJson(path.join(repositoryRoot, "decision-log.json"));
  const decisions = [];
  if (Array.isArray(decisionLog?.decisions)) {
    for (const d of decisionLog.decisions) {
      decisions.push({
        id: d.id || `decision-${decisions.length + 1}`,
        title: d.title || "decision",
        content: String(d.text || d.description || ""),
        taskId: d.taskId ? String(d.taskId).toUpperCase() : null,
        repository: d.repository || null,
      });
    }
  }

  const architecturePath = path.join(repositoryRoot, "architecture-wiki.md");
  if (fs.existsSync(architecturePath)) {
    const content = readTextSafe(architecturePath) || "";
    decisions.push({
      id: "architecture-wiki",
      title: "architecture-wiki",
      content,
      path: "architecture-wiki.md",
      repository: null,
    });
  }

  return { pages, decisions };
}

function buildIndexContent(repositoryRoot) {
  const sourceConfig = loadSearchConfig();
  const codeItems = [];
  const docItems = [];
  const symbolItems = [];
  const sourceEntries = collectSourceEntries(repositoryRoot, {});

  for (const entry of sourceEntries) {
    const { kind, relativePath, absolutePath, content, repositoryPath } = entry;
    const normalized = {
      repository: repositoryPath,
      file: relativePath,
      kind,
      path: relativePath,
      repositoryPath,
      sha1: sha1(content || ""),
      size: entry.size,
      tokenCount: (content || "").length,
      snippet: snippetFrom(content, "TODO", sourceConfig.search.snippetWindow || 4),
      content,
    };

    if (kind === "code") {
      codeItems.push(normalized);
      const symbols = extractSymbolCandidates(content, repositoryPath, relativePath);
      for (const symbol of symbols) {
        symbolItems.push({
          ...symbol,
          tokenSet: [...tokenSet(content)],
          snippet: symbol.code || snippetFrom(content, symbol.symbol, sourceConfig.search.snippetWindow || 4),
          sha1: normalized.sha1,
        });
      }
    } else {
      docItems.push(normalized);
    }
  }

  const taskItems = collectTaskRecords(repositoryRoot).map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    repository: task.repository || null,
    state: task.state,
    decisions: task.decisions,
    files: task.files,
    tags: task.tags,
    tokenSet: [...tokenSet(`${task.id} ${task.title} ${task.description}`)],
    snippet: snippetFrom(`${task.id} ${task.title} ${task.description}`, task.title || task.id),
  }));

  const depItems = collectDependencyRecords(repositoryRoot).map((edge) => ({
    from: edge.from,
    to: edge.to,
    type: edge.type,
    repository: edge.repository,
    tokenSet: [...tokenSet(`${edge.from} ${edge.to} ${edge.type}`)],
  }));

  const wikiRecords = collectWikiRecords(repositoryRoot);
  for (const dec of wikiRecords.decisions) {
    docItems.push({
      repository: dec.repository || null,
      file: dec.path || "decision-document",
      kind: "docs",
      path: dec.path || `decisions/${dec.id}`,
      title: dec.title,
      id: dec.id,
      content: dec.content,
      tokenSet: [...tokenSet(`${dec.id} ${dec.title} ${dec.content}`)],
      sha1: sha1(`${dec.id} ${dec.title} ${dec.content}`),
      size: (dec.content || "").length,
      snippet: snippetFrom(dec.content, dec.title || dec.id),
      source: "decision-log",
    });
  }
  for (const page of wikiRecords.pages) {
    docItems.push({
      repository: page.repository || null,
      file: page.path || "wiki-page",
      kind: "docs",
      path: `wiki/${page.path || page.id}`,
      title: page.title,
      id: page.id,
      content: page.content,
      tokenSet: [...tokenSet(`${page.title} ${page.content}`)],
      sha1: sha1(page.content || ""),
      size: (page.content || "").length,
      snippet: snippetFrom(page.content, page.title || page.id),
      source: "git-wiki",
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceCount: sourceEntries.length,
    codeCount: codeItems.length,
    docCount: docItems.length,
    taskCount: taskItems.length,
    dependencyCount: depItems.length,
    symbolCount: symbolItems.length,
    sourceFingerprints: sourceEntries.map((entry) => ({
      repository: entry.repositoryPath,
      file: entry.relativePath,
      fingerprint: fileFingerprint(entry.absolutePath),
    })),
  };

  return { manifest, codeItems, docItems, taskItems, depItems, symbolItems };
}

function writeIndexSet(indexRoot, value, fileName) {
  ensureDir(indexRoot);
  const filePath = path.join(indexRoot, fileName);
  writeJson(filePath, value);
  return filePath;
}

function validateExistingSource(root, manifest, sourceEntries) {
  if (!manifest || !Array.isArray(manifest.sourceFingerprints)) {
    return false;
  }
  if (manifest.sourceFingerprints.length !== sourceEntries.length) {
    return false;
  }
  const incoming = new Map();
  for (const row of sourceEntries) {
    incoming.set(`${row.repositoryPath}:${row.relativePath}`, fileFingerprint(row.absolutePath));
  }
  for (const row of manifest.sourceFingerprints) {
    const key = `${row.repository}:${row.file}`;
    if (!incoming.has(key)) {
      return false;
    }
    if (incoming.get(key) !== row.fingerprint) {
      return false;
    }
  }
  return true;
}

function buildIndexes(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const profileName = options.profile || "coder";
  const profiles = loadProfiles();
  const profile = normalizeProfile(profiles[profileName] || profiles.coder || {});
  const config = loadSearchConfig(options.configPath);
  const sourceEntries = collectSourceEntries(repositoryRoot, profile);

  const indexRoot = options.indexRoot || INDEX_ROOT;
  const codeDir = path.join(indexRoot, "code");
  const docsDir = path.join(indexRoot, "docs");
  const tasksDir = path.join(indexRoot, "tasks");
  const depsDir = path.join(indexRoot, "dependencies");

  const built = buildIndexContent(repositoryRoot);
  const manifestPath = path.join(indexRoot, "manifest.json");
  const previousManifest = readJson(manifestPath);
  if (options.incremental && previousManifest && validateExistingSource(repositoryRoot, previousManifest, sourceEntries)) {
    return {
      repositoryRoot,
      profile: profileName,
      incremental: true,
      generatedAt: previousManifest.generatedAt || new Date().toISOString(),
      codeIndexPath: path.join(codeDir, "index.json"),
      docsIndexPath: path.join(docsDir, "index.json"),
      tasksIndexPath: path.join(tasksDir, "index.json"),
      dependenciesIndexPath: path.join(depsDir, "index.json"),
      skipped: true,
      entries: sourceEntries.length,
    };
  }

  const codeIndex = {
    repositoryRoot,
    profile: profileName,
    generatedAt: new Date().toISOString(),
    weights: config.ranking.weights,
    items: built.codeItems,
  };
  const docsIndex = {
    repositoryRoot,
    profile: profileName,
    generatedAt: new Date().toISOString(),
    items: built.docItems,
  };
  const tasksIndex = {
    repositoryRoot,
    profile: profileName,
    generatedAt: new Date().toISOString(),
    items: built.taskItems,
  };
  const dependenciesIndex = {
    repositoryRoot,
    profile: profileName,
    generatedAt: new Date().toISOString(),
    items: built.depItems,
  };
  const symbolIndex = {
    repositoryRoot,
    profile: profileName,
    generatedAt: new Date().toISOString(),
    items: built.symbolItems,
  };

  const codePath = writeIndexSet(codeDir, codeIndex, "index.json");
  const docsPath = writeIndexSet(docsDir, docsIndex, "index.json");
  const tasksPath = writeIndexSet(tasksDir, tasksIndex, "index.json");
  const depsPath = writeIndexSet(depsDir, dependenciesIndex, "index.json");
  const symbolPath = writeIndexSet(path.join(indexRoot, "symbols"), symbolIndex, "index.json");

  const manifest = {
    ...built.manifest,
    repositoryRoot,
    profile: profileName,
    generatedBy: "build-index",
    sourceFingerprints: built.manifest.sourceFingerprints,
  };
  writeJson(manifestPath, manifest);
  writeJson(path.join(indexRoot, "symbols", "manifest.json"), manifest);

  return {
    repositoryRoot,
    profile: profileName,
    incremental: false,
    generatedAt: manifest.generatedAt,
    codeIndexPath: codePath,
    docsIndexPath: docsPath,
    tasksIndexPath: tasksPath,
    dependenciesIndexPath: depsPath,
    symbolIndexPath: symbolPath,
    entries: sourceEntries.length,
    skipped: false,
  };
}

function updateIndexes(options = {}) {
  return buildIndexes({ ...options, incremental: true });
}

function readIndex(pathOrObj) {
  if (typeof pathOrObj === "object") return pathOrObj;
  return readJson(pathOrObj) || { items: [] };
}

function loadSymbolIndex(root = process.cwd(), indexRoot = INDEX_ROOT) {
  return readIndex(path.join(indexRoot, "symbols", "index.json"));
}

function loadCodeIndex(root = process.cwd(), indexRoot = INDEX_ROOT) {
  return readIndex(path.join(indexRoot, "code", "index.json"));
}

function loadDocsIndex(root = process.cwd(), indexRoot = INDEX_ROOT) {
  return readIndex(path.join(indexRoot, "docs", "index.json"));
}

function loadTasksIndex(root = process.cwd(), indexRoot = INDEX_ROOT) {
  return readIndex(path.join(indexRoot, "tasks", "index.json"));
}

function loadDependencyIndex(root = process.cwd(), indexRoot = INDEX_ROOT) {
  return readIndex(path.join(indexRoot, "dependencies", "index.json"));
}

function normalizeQuery(input) {
  return String(input || "").trim();
}

function normalizeLimit(limit, fallback = 25) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(200, Math.floor(parsed));
}

function semanticSearch(options = {}) {
  const query = normalizeQuery(options.query);
  const limit = normalizeLimit(options.limit, 25);
  const root = path.resolve(options.repositoryRoot || process.cwd());
  const profile = normalizeProfile((loadProfiles()[options.profile] || loadProfiles().coder || {}));
  const config = loadSearchConfig();
  const useVector = options.preferVector && config.search?.semantic?.enabled && config.search.semantic.enabled !== false;
  const reason = useVector ? "embedding-disabled" : "keyword-fallback";
  const codeIndex = loadCodeIndex(root, options.indexRoot || INDEX_ROOT);
  const docsIndex = loadDocsIndex(root, options.indexRoot || INDEX_ROOT);
  const all = [...(codeIndex.items || []), ...(docsIndex.items || [])];
  const qTokens = tokenSet(query);

  const results = [];
  for (const item of all) {
    const targetSet = new Set(item.tokenSet || tokenSet(item.content || `${item.title || ""} ${item.snippet || ""}`));
    const semanticScore = overlapScore(qTokens, targetSet);
    const phraseBonus = item.content && String(item.content).toLowerCase().includes(query.toLowerCase()) ? 0.25 : 0;
    const exactTitle = exactMatchScore(query, item.title || item.file || item.id);
    const score = parseFloat(Math.min(1, semanticScore * 0.9 + phraseBonus + exactTitle * 0.1).toFixed(4));
    if (score > 0) {
      const snippet = snippetFrom(String(item.content || ""), query || item.title || item.id || "", config.search?.snippetWindow || 4);
      results.push({
        score,
        repository: item.repository || item.repositoryPath || null,
        file: item.file || item.path || null,
        symbol: item.title || item.id || null,
        snippet,
        reason: reason === "keyword-fallback" ? "fallback: keyword and token overlap" : "vector+keyword blend",
        query,
        type: "semantic",
        semanticRelevance: score,
        taskRelevance: 0,
        dependencyRelevance: 0,
        ownershipRelevance: 0,
        documentationRelevance: item.kind === "docs" ? score : 0,
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.file).localeCompare(String(b.file));
  });
  return { results: results.slice(0, limit), query, profile: profile.name, mode: reason, total: results.length };
}

function symbolSearch(options = {}) {
  const query = normalizeQuery(options.symbolName || options.query || "");
  const limit = normalizeLimit(options.limit, 25);
  const root = path.resolve(options.repositoryRoot || process.cwd());
  const symbolIndex = loadSymbolIndex(root, options.indexRoot || INDEX_ROOT);
  const qLower = query.toLowerCase();
  const exact = [];
  const partial = [];

  const symbols = symbolIndex.items || [];
  for (const row of symbols) {
    const s = String(row.symbol || "").toLowerCase();
    if (!s.includes(qLower)) continue;
    const exactMatch = s === qLower;
    const score = exactMatch ? 1 : 0.6;
    const snippet = row.snippet || "";

    const related = symbols
      .filter((candidate) => candidate.file === row.file && String(candidate.symbol).toLowerCase() !== s)
      .slice(0, 5)
      .map((candidate) => ({
        symbol: candidate.symbol,
        kind: candidate.kind,
        file: candidate.file,
        repository: candidate.repository,
      }));

    const references = row.code ? [row.code] : [];
    const payload = {
      score,
      repository: row.repository,
      file: row.file,
      symbol: row.symbol,
      snippet,
      line: row.line,
      kind: row.kind,
      exact: exactMatch,
      references,
      relatedSymbols: related,
      reason: exactMatch ? "exact symbol match" : "partial symbol match",
      query: qLower,
      type: "symbol",
      symbolRelevance: score,
      semanticRelevance: 0,
      taskRelevance: 0,
      dependencyRelevance: 0,
      ownershipRelevance: 0,
      documentationRelevance: 0,
    };

    if (exactMatch) exact.push(payload);
    else partial.push(payload);
  }

  const results = [...exact, ...partial].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.file).localeCompare(String(b.file));
  });
  return { results: results.slice(0, limit), query: qLower, total: results.length };
}

function taskSearch(options = {}) {
  const query = normalizeQuery(options.query);
  const root = path.resolve(options.repositoryRoot || process.cwd());
  const limit = normalizeLimit(options.limit, 25);
  const qLower = query.toLowerCase();
  const tasks = loadTasksIndex(root, options.indexRoot || INDEX_ROOT).items || [];
  const qTokens = tokenSet(query);

  const results = [];
  for (const task of tasks) {
    const id = String(task.id || "").toUpperCase();
    let score = 0;
    if (id && qLower && id.toLowerCase() === qLower) {
      score += 1;
    }
    const content = `${task.id} ${task.title} ${task.description}`;
    const sim = overlapScore(qTokens, new Set(task.tokenSet || tokenSet(content)));
    score += sim * 0.6;
    if (score > 0) {
      results.push({
        score: parseFloat(Math.min(1, score).toFixed(4)),
        taskId: id,
        repository: task.repository || null,
        files: task.files || [],
        snippet: task.snippet,
        title: task.title,
        reason: "task title/description or id match",
        type: "task",
        taskRelevance: Math.min(1, score),
        dependencyRelevance: 0,
        ownershipRelevance: 0,
        semanticRelevance: sim,
        symbolRelevance: 0,
        documentationRelevance: 0,
      });
    }
  }
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.taskId.localeCompare(b.taskId);
  });
  return { results: results.slice(0, limit), query };
}

function dependencySearch(options = {}) {
  const query = normalizeQuery(options.query || options.task || "").toUpperCase();
  const limit = normalizeLimit(options.limit, 25);
  const deps = loadDependencyIndex(options.repositoryRoot || process.cwd(), options.indexRoot || INDEX_ROOT).items || [];
  const rows = [];
  for (const edge of deps) {
    if (String(edge.from || "").toUpperCase() === query || String(edge.to || "").toUpperCase() === query || (query === "" && false)) {
      const score = query ? 1 : 0;
      rows.push({
        score,
        repository: edge.repository || null,
        from: edge.from,
        to: edge.to,
        type: edge.type || "depends_on",
        direction: String(edge.from || "").toUpperCase() === query ? "outgoing" : "incoming",
        snippet: `${edge.from} -> ${edge.to} (${edge.type})`,
        reason: "dependency graph relation",
        taskRelevance: 0.8,
        dependencyRelevance: 1,
        ownershipRelevance: 0,
        semanticRelevance: 0,
        symbolRelevance: 0,
        documentationRelevance: 0,
      });
    }
  }
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`);
  });
  return { results: rows.slice(0, limit), query };
}

function architectureSearch(options = {}) {
  const query = normalizeQuery(options.query);
  const limit = normalizeLimit(options.limit, 25);
  const docs = loadDocsIndex(options.repositoryRoot || process.cwd(), options.indexRoot || INDEX_ROOT).items || [];
  const q = query.toLowerCase();
  const qTokens = tokenSet(query);
  const rows = [];

  for (const doc of docs) {
    const fileName = String(doc.file || "").toLowerCase();
    const isArchitecture = fileName.includes("architecture") || fileName.includes("decision") || doc.source === "decision-log" || doc.source === "git-wiki";
    if (!isArchitecture) continue;
    const sim = overlapScore(qTokens, new Set(doc.tokenSet || tokenSet(`${doc.title || ""} ${doc.content || ""}`)));
    const content = String(doc.content || "");
    const phrase = content.toLowerCase().includes(q);
    const score = (sim * 0.8) + (phrase ? 0.2 : 0);
    if (score > 0) {
      rows.push({
        score: parseFloat(Math.min(1, score).toFixed(4)),
        repository: doc.repository || null,
        file: doc.file,
        symbol: doc.title || doc.id,
        snippet: doc.snippet,
        reason: "architecture/wiki decision source",
        query: q,
        taskRelevance: q.match(/mc-\d+/i) ? 0.6 : 0,
        dependencyRelevance: 0,
        ownershipRelevance: 0,
        semanticRelevance: sim,
        symbolRelevance: 0,
        documentationRelevance: Math.min(1, score + 0.2),
        type: "architecture",
      });
    }
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.file).localeCompare(String(b.file));
  });

  return { results: rows.slice(0, limit), query };
}

function rankCombined(results) {
  const config = loadSearchConfig();
  const weights = config.ranking.weights || {};
  for (const row of results) {
    const score =
      (row.taskRelevance || 0) * (weights.taskRelevance || 1) +
      (row.dependencyRelevance || 0) * (weights.dependencyRelevance || 1) +
      (row.ownershipRelevance || 0) * (weights.repositoryOwnershipRelevance || 1) +
      (row.semanticRelevance || 0) * (weights.semanticRelevance || 1) +
      (row.symbolRelevance || 0) * (weights.symbolRelevance || 1) +
      (row.documentationRelevance || 0) * (weights.documentationRelevance || 1);
    row.rankScore = parseFloat((score || 0).toFixed(5));
  }
  results.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (b.score !== a.score && Number.isFinite(b.score) && Number.isFinite(a.score)) {
      return b.score - a.score;
    }
    return String(a.file || a.taskId || a.from || "").localeCompare(String(b.file || b.taskId || b.from || ""));
  });
  return results;
}

function mergeByFile(results) {
  const byKey = new Map();
  for (const item of results) {
    const file = item.file || `${item.from || ""}->${item.to || ""}`;
    const repository = item.repository || "unknown";
    const key = `${repository}|${file}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    if ((item.rankScore || item.score || 0) > (existing.rankScore || existing.score || 0)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function repositoryOwnershipBoost(item, query, profile) {
  if (!query) return 0.1;
  const q = query.toLowerCase();
  const repo = String(item.repository || "").toLowerCase();
  if (repo && q.includes(repo)) return 0.9;
  if (profile?.priorities?.includes("ownership")) return 0.2;
  return 0;
}

function toHybridResult(result, query, profile) {
  const token = { ...result };
  token.rankScore = 0;
  token.ownershipRelevance = repositoryOwnershipBoost(token, String(query), profile);
  token.semanticRelevance = token.semanticRelevance || 0;
  token.symbolRelevance = token.symbolRelevance || (token.type === "symbol" ? token.score || 0 : 0);
  token.documentationRelevance =
    token.documentationRelevance || (token.type === "architecture" || token.type === "docs" ? token.score || 0 : 0);
  return token;
}

function hybridSearch(options = {}) {
  const query = normalizeQuery(options.query);
  const limit = normalizeLimit(options.limit, 25);
  const profileName = options.profile || "coder";
  const profiles = loadProfiles();
  const profile = normalizeProfile(profiles[profileName] || profiles.coder || {});

  const semantic = semanticSearch({ ...options, profile: profileName }).results || [];
  const symbol = symbolSearch({ ...options, symbolName: query, profile: profileName }).results || [];
  const tasks = taskSearch({ ...options, profile: profileName, query }).results || [];
  const deps = dependencySearch({ ...options, profile: profileName, query }).results || [];
  const arch = architectureSearch({ ...options, profile: profileName, query }).results || [];

  const combined = [];
  for (const row of [...semantic, ...symbol, ...tasks, ...deps, ...arch]) {
    combined.push(toHybridResult(row, query, profile));
  }

  const ranked = rankCombined(mergeByFile(combined));
  return {
    query,
    profile: profileName,
    results: ranked.slice(0, limit).map((row) => ({
      ...row,
      ranking: {
        taskRelevance: row.taskRelevance || 0,
        dependencyRelevance: row.dependencyRelevance || 0,
        repositoryOwnershipRelevance: row.ownershipRelevance || 0,
        semanticRelevance: row.semanticRelevance || 0,
        symbolRelevance: row.symbolRelevance || 0,
        documentationRelevance: row.documentationRelevance || 0,
      },
      reason: row.reason || "hybrid score",
      score: row.score || row.rankScore || 0,
      repository: row.repository,
      file: row.file,
    })),
    total: ranked.length,
  };
}

function find_context_for_task(options = {}) {
  const taskId = String(options.taskId || options.query || "").toUpperCase();
  const limit = normalizeLimit(options.limit, 25);
  const root = path.resolve(options.repositoryRoot || process.cwd());
  const profile = normalizeProfile((loadProfiles()[options.profile] || loadProfiles().coder || {}));

  const taskMatches = taskSearch({ repositoryRoot: root, query: taskId, limit });
  const depMatches = dependencySearch({ repositoryRoot: root, query: taskId, limit: Math.max(5, Math.ceil(limit / 3)) });
  const semanticMatches = semanticSearch({ repositoryRoot: root, query: taskId, limit: Math.max(5, Math.ceil(limit / 2)) });
  const archMatches = architectureSearch({ repositoryRoot: root, query: taskId, limit: Math.max(5, Math.ceil(limit / 2)) });

  const ranked = rankCombined([
    ...taskMatches.results,
    ...depMatches.results,
    ...semanticMatches.results,
    ...archMatches.results,
  ].map((row) => toHybridResult(row, taskId, profile)));

  const files = [];
  const decisions = [];
  const documentation = [];
  const dependencies = [];
  const repositories = new Set();

  for (const row of ranked.slice(0, limit)) {
    if (row.file && row.file !== `${row.from}->${row.to}`) {
      files.push({
        repository: row.repository,
        path: row.file,
      });
      repositories.add(row.repository || "");
    }
    if (row.decision) {
      decisions.push(row.decision);
    }
    if (row.source === "git-wiki" || row.type === "architecture" || row.type === "docs") {
      documentation.push({
        repository: row.repository || null,
        path: row.file || row.symbol || "",
      });
    }
    if (row.type === "task" && row.taskId && row.taskId !== taskId) {
      dependencies.push({ from: taskId, to: row.taskId, type: "task-related" });
    }
    if (row.type === "dependency" || row.from) {
      if (row.from && row.to) {
        dependencies.push({ from: row.from, to: row.to, type: row.type || "depends_on" });
      }
    }
  }

  const uniqueFiles = [];
  const seen = new Set();
  for (const f of files) {
    const key = `${f.repository || ""}:${f.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFiles.push(f);
  }

  return {
    taskId,
    profile: profile.name,
    files: uniqueFiles,
    decisions: [...new Set(decisions)],
    documentation: [...new Set(documentation.map((row) => JSON.stringify(row)))].map((row) => JSON.parse(row)),
    dependencies,
    relatedTasks: taskMatches.results.map((row) => row.taskId).filter(Boolean),
    repositoryCount: repositories.size,
    query,
  };
}

function find_context_for_pr(options = {}) {
  const prNumber = String(options.prNumber || options.query || "");
  const taskHint = options.taskId ? String(options.taskId).toUpperCase() : "";
  const root = path.resolve(options.repositoryRoot || process.cwd());
  const limit = normalizeLimit(options.limit, 25);

  const nexusData = readJson(path.join(root, "git-nexus.json")) || {};
  const candidate = [];
  if (Array.isArray(nexusData.prs)) {
    for (const pr of nexusData.prs) {
      const num = String(pr.number || pr.id || "");
      if (num === prNumber) {
        candidate.push(...(Array.isArray(pr.changedFiles) ? pr.changedFiles : []));
        if (Array.isArray(pr.relatedTasks)) {
          candidate.push(...pr.relatedTasks);
        }
      }
    }
  }

  const relatedTasks = taskHint ? [taskHint] : candidate.filter((row) => String(row).toUpperCase().startsWith("MC-")).slice(0, 4);
  const taskQueries = relatedTasks.map((task) =>
    find_context_for_task({ repositoryRoot: root, taskId: task, limit: Math.max(3, Math.floor(limit / relatedTasks.length || 1)) }),
  );
  const mergedFiles = [];
  const dependencies = [];
  const decisions = [];
  const documentation = [];

  for (const hit of taskQueries) {
    mergedFiles.push(...hit.files);
    dependencies.push(...hit.dependencies);
    decisions.push(...hit.decisions);
    documentation.push(...hit.documentation);
  }

  const semantic = [];
  if (candidate.length > 0) {
    for (const item of candidate) {
      const result = semanticSearch({ repositoryRoot: root, query: item, limit: Math.ceil(limit / 5) });
      semantic.push(...result.results);
    }
  }

  const ranked = rankCombined(
    semantic.map((row) => toHybridResult(row, prNumber, normalizeProfile((loadProfiles().reviewer || {})))),
  );

  return {
    prNumber,
    profile: "reviewer",
    files: mergedFiles,
    decisions: [...new Set(decisions)],
    dependencies,
    documentation: [...new Set(documentation.map((row) => JSON.stringify(row)))].map((row) => JSON.parse(row)),
    relatedTasks,
    relatedReviews: ranked.slice(0, limit).map((row) => ({ file: row.file, repository: row.repository, score: row.rankScore || row.score || 0 })),
  };
}

function find_context_for_review(options = {}) {
  return find_context_for_pr(options);
}

function validateIndex(options = {}) {
  const indexRoot = path.resolve(options.indexRoot || INDEX_ROOT);
  const manifestPath = path.join(indexRoot, "manifest.json");
  const symbolManifestPath = path.join(indexRoot, "symbols", "manifest.json");
  const symbolManifest = readJson(symbolManifestPath);
  const manifest = readJson(manifestPath);
  const failures = [];

  const required = ["code", "docs", "tasks", "dependencies"];
  for (const dir of required) {
    const p = path.join(indexRoot, dir, "index.json");
    if (!fs.existsSync(p)) {
      failures.push(`missing index: ${dir}`);
    }
  }

  if (!manifest) {
    failures.push("missing manifest");
    return { valid: false, failures, counts: { items: 0 } };
  }

  const indexes = [
    loadCodeIndex(options.repositoryRoot || process.cwd(), indexRoot),
    loadDocsIndex(options.repositoryRoot || process.cwd(), indexRoot),
    loadTasksIndex(options.repositoryRoot || process.cwd(), indexRoot),
    loadDependencyIndex(options.repositoryRoot || process.cwd(), indexRoot),
    loadSymbolIndex(options.repositoryRoot || process.cwd(), indexRoot),
  ];
  const pathCounts = indexes.map((idx, i) => ({ kind: required[i] || "symbol", count: (idx && idx.items ? idx.items.length : 0) }));

  const seenPaths = new Set();
  for (const idx of indexes) {
    for (const row of idx.items || []) {
      if (row.path) {
        if (seenPaths.has(row.path)) {
          failures.push(`duplicate path in index: ${row.path}`);
        }
        seenPaths.add(row.path);
      }
    }
  }

  if (manifest.generatedAt == null) {
    failures.push("manifest missing generatedAt");
  }
  if (symbolManifest && manifest.generatedAt && symbolManifest.generatedAt !== manifest.generatedAt) {
    failures.push("symbol manifest out of sync");
  }

  return { valid: failures.length === 0, failures, counts: pathCounts, generatedAt: manifest.generatedAt || null, indexRoot };
}

module.exports = {
  loadSearchConfig,
  loadProfiles,
  buildIndexes,
  updateIndexes,
  semanticSearch,
  symbolSearch,
  taskSearch,
  architectureSearch,
  dependencySearch,
  hybridSearch,
  validateIndex,
  find_context_for_task,
  find_context_for_pr,
  find_context_for_review,
  parseRepositoryContext: collectSourceEntries,
};
