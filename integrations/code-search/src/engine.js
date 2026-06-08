const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "search-config.json");
const DEFAULT_INDEX_DIR = "generated-code-search";
const DEFAULT_INDEX_FILE = "index.json";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readText(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("\u0000")) return null;
  return raw;
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  return require("node:child_process").spawnSync(checker, [command], { encoding: "utf8" }).status === 0;
}

function normalizePath(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^\.\/|^\.\.\/|^\//, "");
}

function stableId(...parts) {
  const seed = parts.join("|");
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function tokenSet(input) {
  const text = String(input || "").toLowerCase();
  const raw = text.match(/[a-z0-9_.$]+/g) || [];
  return new Set(raw);
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) {
    if (b.has(token)) common += 1;
  }
  return common / Math.max(a.size, b.size);
}

function snippetFrom(text, lineNumber, lineWindow = 3) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length === 0) return "";
  const index = Math.max(0, Math.min(lines.length - 1, Number(lineNumber || 1) - 1));
  const start = Math.max(0, index - lineWindow);
  const end = Math.min(lines.length - 1, index + lineWindow);
  return lines.slice(start, end + 1).map((row) => row.trim()).join(" ").replace(/\s+/g, " ").trim();
}

function scoreMatch(query, target, baseBoost, exactBoost) {
  if (!query) return 0;
  const q = String(query || "").toLowerCase();
  const t = String(target || "").toLowerCase();
  if (!t.includes(q)) return 0;
  const exact = t === q ? 1 : 0;
  return Math.min(1, overlap(tokenSet(q), tokenSet(t)) * 0.7 + exact * exactBoost + baseBoost);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBinaryPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const binary = new Set([
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
  return binary.has(ext);
}

function matchesPattern(fileName, patterns) {
  const base = path.basename(fileName).toLowerCase();
  for (const pattern of patterns) {
    const p = String(pattern || "").toLowerCase();
    if (!p.includes("*")) {
      if (base === p || base.endsWith(p)) return true;
      continue;
    }
    const escaped = "^" + p.split("*").map(escapeRegExp).join(".*") + "$";
    if (new RegExp(escaped).test(base)) return true;
  }
  return false;
}

function walkFiles(rootAbs, config, includeDirectoryGuard) {
  const files = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(rootAbs, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      const childName = entry.name;
      const childRel = rel ? `${rel}/${childName}` : childName;
      if (entry.isDirectory()) {
        const normalized = childRel.replace(/\\/g, "/");
        if (includeDirectoryGuard(normalized)) continue;
        stack.push(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = childRel.replace(/\\/g, "/");
      const ext = path.extname(childName).toLowerCase();
      if (config.skipFilePatterns && matchesPattern(childName, config.skipFilePatterns)) continue;
      if (config.indexing && !isTargetFile(ext, config.indexing.codeExtensions, config.indexing.docExtensions)) continue;
      if (isBinaryPath(childName)) continue;
      files.push({
        fileName: normalized,
        absPath: path.join(rootAbs, normalized),
      });
    }
  }
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function isTargetFile(ext, codeExtensions, docExtensions) {
  const all = new Set([...(codeExtensions || []), ...(docExtensions || [])]);
  return all.has(ext);
}

function isDocFile(file, docExtensions) {
  return docExtensions.includes(path.extname(file).toLowerCase());
}

function loadSearchConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readJson(configPath);
  if (!raw) {
    throw new Error(`Missing code-search config: ${configPath}`);
  }
  const cfg = { ...raw };
  cfg.indexing = cfg.indexing || {};
  cfg.indexing.codeExtensions = cfg.indexing.codeExtensions || [];
  cfg.indexing.docExtensions = cfg.indexing.docExtensions || [];
  cfg.indexing.skipDirectories = cfg.indexing.skipDirectories || [];
  cfg.indexing.skipFilePatterns = cfg.indexing.skipFilePatterns || [];
  cfg.defaults = cfg.defaults || {};
  return cfg;
}

function loadSourcebotProvider(configPath = DEFAULT_CONFIG_PATH) {
  const config = loadSearchConfig(configPath);
  const providerPath = path.join(__dirname, "..", "providers", "sourcebot", "index.js");
  if (!fs.existsSync(providerPath)) return null;
  try {
    const provider = require(providerPath);
    if (!provider || typeof provider.isAvailable !== "function") return null;
    return provider;
  } catch {
    return null;
  }
}

function findRepos(rootAbs, repoRootName = "repo-registry.json") {
  const payload = readJson(path.join(rootAbs, repoRootName));
  if (!payload || typeof payload.repositories !== "object") {
    const fallback = path.basename(rootAbs || ".");
    return [{
      id: ".",
      path: ".",
      owner: "unknown",
      team: "unknown",
    },];
  }
  const repos = [];
  for (const [name, row] of Object.entries(payload.repositories)) {
    const item = row || {};
    repos.push({
      id: name,
      path: String(item.path || name).replace(/\\/g, "/"),
      owner: item.owner || item.team || "unknown",
      team: item.team || item.owner || "unknown",
      responsibilities: Array.isArray(item.responsibilities) ? item.responsibilities : [],
    });
  }
  return repos.length > 0
    ? repos.sort((a, b) => a.id.localeCompare(b.id))
    : [{ id: ".", path: ".", owner: "unknown", team: "unknown" }];
}

function collectOwnershipArtifacts(rootAbs, config) {
  const issueData = readJson(path.join(rootAbs, config.integrations?.globalIssues || "global-issues.json")) || {};
  const depData = readJson(path.join(rootAbs, config.integrations?.dependencyMap || "dependency-map.json")) || {};
  const decisionData = readJson(path.join(rootAbs, config.integrations?.decisionLog || "decision-log.json")) || {};
  const wikiData = readJson(path.join(rootAbs, config.integrations?.gitWiki || "git-wiki.json")) || {};
  const architecture = readText(path.join(rootAbs, config.integrations?.architectureWiki || "architecture-wiki.md"));
  return {
    tasks: Array.isArray(issueData.tasks) ? issueData.tasks : [],
    dependencies: Array.isArray(depData.dependencies) ? depData.dependencies : [],
    decisions: Array.isArray(decisionData.decisions) ? decisionData.decisions : [],
    wiki: Array.isArray(wikiData.pages) ? wikiData.pages : [],
    architecture: architecture ? ["ARCHITECTURE"] : [],
  };
}

function discoverSymbols(content, repository, file) {
  const lines = String(content || "").split(/\r?\n/);
  const rows = [];
  const regexes = [
    { kind: "function", regex: /\b(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)/g },
    { kind: "function", regex: /\b(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g },
    { kind: "function", regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g },
    { kind: "function", regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function\b/g },
    { kind: "class", regex: /\bclass\s+([A-Za-z_$][\w$]*)/g },
    { kind: "interface", regex: /\binterface\s+([A-Za-z_$][\w$]*)/g },
    { kind: "module", regex: /\bmodule\s+([A-Za-z_$][\w$]*)/g },
    { kind: "type", regex: /\btype\s+([A-Za-z_$][\w$]*)\s*=/g },
    { kind: "function", regex: /\bdef\s+([A-Za-z_$][\w$]*)/g },
  ];
  const implementRows = new Map();
  const extendRows = new Map();
  for (let lineNo = 1; lineNo <= lines.length; lineNo += 1) {
    const line = lines[lineNo - 1];
    for (const entry of regexes) {
      const rgx = new RegExp(entry.regex.source, "g");
      let m = null;
      while ((m = rgx.exec(line)) !== null) {
        const symbol = m[1];
        if (!symbol) continue;
        const lower = symbol.toLowerCase();
        const row = {
          id: stableId(repository, file, symbol, lineNo, entry.kind),
          kind: entry.kind,
          symbol,
          repository,
          file,
          line: lineNo,
          snippet: line.trim(),
          implements: [],
          extends: [],
        };
        rows.push(row);
      }
    }
    const implMatch = line.match(/\bclass\s+([A-Za-z_$][\w$]*)\s+implements\s+([^{}\n]+)/i);
    if (implMatch) {
      const name = implMatch[1];
      const parts = implMatch[2].split(",").map((item) => item.trim()).filter(Boolean);
      implementRows.set(name, (implementRows.get(name) || []).concat(parts));
    }
    const extendMatch = line.match(/\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+([A-Za-z_$][\w$]*)/i);
    if (extendMatch) {
      extendRows.set(extendMatch[1], extendRows.get(extendMatch[1]) || []);
      extendRows.get(extendMatch[1]).push(extendMatch[2]);
    }
  }
  for (const row of rows) {
    if (implementRows.has(row.symbol)) row.implements = implementRows.get(row.symbol);
    if (extendRows.has(row.symbol)) row.extends = extendRows.get(row.symbol);
  }
  return rows;
}

function collectApiUsages(content, repository, file) {
  const lines = String(content || "").split(/\r?\n/);
  const usage = [];
  const endpointRegex = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`](\/[^"'`\\)]+)["'`]/gi;
  const fetchRegex = /\bfetch\s*\(\s*["'`](\/[^"'`]+)["'`]/gi;
  const importRegex = /\bimport\s+.*\s+from\s+["'`]([^"'`]+)["'`]/gi;
  const serviceRegex = /\bnew\s+([A-Za-z_$][\w$]*)Service\b/g;
  lines.forEach((line, index) => {
    let m = null;
    while ((m = endpointRegex.exec(line)) !== null) {
      usage.push({
        id: stableId(repository, file, m[1], "endpoint", index + 1),
        kind: "endpoint",
        symbol: `${m[1].toUpperCase()} ${m[2]}`,
        repository,
        file,
        line: index + 1,
        snippet: line.trim(),
      });
    }
    while ((m = fetchRegex.exec(line)) !== null) {
      usage.push({
        id: stableId(repository, file, "fetch", m[1], index + 1),
        kind: "endpoint",
        symbol: `FETCH ${m[1]}`,
        repository,
        file,
        line: index + 1,
        snippet: line.trim(),
      });
    }
    while ((m = importRegex.exec(line)) !== null) {
      usage.push({
        id: stableId(repository, file, "import", m[1], index + 1),
        kind: "module",
        symbol: m[1],
        repository,
        file,
        line: index + 1,
        snippet: line.trim(),
      });
    }
    while ((m = serviceRegex.exec(line)) !== null) {
      usage.push({
        id: stableId(repository, file, "service", m[1], index + 1),
        kind: "service",
        symbol: m[1],
        repository,
        file,
        line: index + 1,
        snippet: line.trim(),
      });
    }
  });
  return usage;
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function collectIndexMetadata(rootAbs, config, repos) {
  const files = [];
  const symbols = [];
  const apiUsages = [];
  for (const repo of repos) {
    const repoAbs = path.resolve(rootAbs, repo.path || ".");
    const repoRows = walkFiles(repoAbs, config, (dir) => config.indexing.skipDirectories.includes(dir.split("/").at(-1)));
    for (const row of repoRows) {
      const rel = `${repo.id}/${row.fileName}`;
      const content = readText(row.absPath);
      if (content === null) continue;
      const lines = content.split(/\r?\n/).length;
      const sha1 = crypto.createHash("sha1").update(content).digest("hex");
      const sourceKind = isDocFile(row.fileName, config.indexing.docExtensions) ? "document" : "code";
      files.push({
        id: stableId(repo.id, rel),
        repository: repo.id,
        file: rel,
        path: rel,
        abs: row.absPath,
        sourceKind,
        size: Buffer.byteLength(content, "utf8"),
        lines,
        sha1,
        tokens: Math.max(1, Math.ceil(content.length / 4)),
      });
      if (sourceKind === "code") {
        symbols.push(...discoverSymbols(content, repo.id, rel));
        apiUsages.push(...collectApiUsages(content, repo.id, rel));
      }
    }
  }
  const sourceFiles = new Set(files.filter((row) => row.sourceKind === "code").map((row) => row.id));
  const docFiles = new Set(files.filter((row) => row.sourceKind === "document").map((row) => row.id));
  return { files, symbols: uniqueBy(symbols, (row) => row.id), apiUsages: uniqueBy(apiUsages, (row) => row.id), sourceFiles, docFiles };
}

function collectReferencesAndCallers(config, roots) {
  const allSymbols = [];
  const references = [];
  const callers = [];
  for (const repoMeta of roots) {
    allSymbols.push(...repoMeta.symbols);
  }
  const byRepositoryFile = new Map();
  for (const repo of roots) {
    for (const file of repo.files) {
      byRepositoryFile.set(`${file.repository}|${file.file}`, file);
    }
  }
  for (const fileMeta of allSymbols) {
    const file = byRepositoryFile.get(fileMeta.repository + "|" + fileMeta.file);
  }
  for (const repo of roots) {
    for (const file of repo.files.filter((row) => row.sourceKind === "code")) {
      const text = fs.readFileSync(file.abs, "utf8");
      const lines = text.split(/\r?\n/);
      for (const symbol of allSymbols) {
        const rgx = new RegExp(`\\b${escapeRegExp(symbol.symbol)}\\b`, "g");
        const definitionSignature = `${symbol.symbol}|${symbol.kind}`;
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i];
          let hits = 0;
          let found = false;
          let m = null;
          while ((m = rgx.exec(line)) !== null) {
            const lineNo = i + 1;
            if (line.toLowerCase().includes("class ") && line.toLowerCase().includes(definitionSignature.toLowerCase())) {
              continue;
            }
            if (hits >= 0) found = true;
            if (found) {
              hits += 1;
              if (line.includes(`${symbol.symbol}(`)) {
                callers.push({
                  repository: file.repository,
                  file: file.file,
                  symbol,
                  callerSymbol: symbol.symbol,
                  line: lineNo,
                  location: `${file.file}:${lineNo}`,
                  callPath: `${file.file}:${lineNo}`,
                  snippet: snippetFrom(text, lineNo, 2),
                  score: scoreMatch(symbol.symbol, line, config.weights?.caller || 0.6, 0.1),
                });
              } else {
                references.push({
                  repository: file.repository,
                  file: file.file,
                  symbol: symbol.symbol,
                  line: lineNo,
                  location: `${file.file}:${lineNo}`,
                  snippet: snippetFrom(text, lineNo, 2),
                  score: scoreMatch(symbol.symbol, line, config.weights?.reference || 0.4, 0.2),
                });
              }
            }
          }
          if (!found) continue;
        }
      }
    }
  }
  return {
    references: uniqueBy(references, (row) => `${row.repository}|${row.file}|${row.line}|${row.symbol}`),
    callers: uniqueBy(callers, (row) => `${row.repository}|${row.file}|${row.line}|${row.symbol?.symbol || ""}`),
  };
}

function buildImplementations(symbolRows) {
  const implRows = [];
  for (const row of symbolRows) {
    for (const implemented of row.implements || []) {
      implRows.push({
        id: stableId("impl", row.repository, row.file, row.symbol, implemented),
        kind: "implements",
        symbol: row.symbol,
        implemented,
        target: "interface",
        repository: row.repository,
        file: row.file,
        line: row.line,
        snippet: row.snippet,
        score: 0.75,
      });
    }
    for (const parent of row.extends || []) {
      implRows.push({
        id: stableId("extend", row.repository, row.file, row.symbol, parent),
        kind: "extends",
        symbol: row.symbol,
        implemented: parent,
        target: "class",
        repository: row.repository,
        file: row.file,
        line: row.line,
        snippet: row.snippet,
        score: 0.7,
      });
    }
  }
  return uniqueBy(implRows, (row) => `${row.symbol}|${row.implemented}|${row.repository}`);
}

function collectOwnerSignals(config, rootAbs, repos, indexMeta) {
  const ownership = [];
  const taskData = collectOwnershipArtifacts(rootAbs, config);
  for (const repo of repos) {
    ownership.push({
      id: stableId("owner", repo.id),
      repository: repo.id,
      owner: repo.owner,
      team: repo.team,
      responsibilities: repo.responsibilities || [],
      sources: ["repo-registry"],
    });
  }
  for (const task of taskData.tasks) {
    const repo = String(task.repository || "").trim();
    if (!repo) continue;
    ownership.push({
      id: stableId("owner", task.id || ""),
      repository: repo,
      owner: String(task.owner || "unknown"),
      team: String(task.team || "unknown"),
      task: task.id,
      responsibilities: task.files || [],
      sources: ["global-issues"],
    });
  }
  for (const rel of taskData.dependencies) {
    if (!rel?.from || !rel?.to) continue;
    ownership.push({
      id: stableId("dep", rel.from, rel.to),
      repository: rel.from,
      owner: "dependency-graph",
      team: "dependency-graph",
      responsibilities: [rel.to],
      sources: ["dependency-map"],
    });
  }
  return uniqueBy(ownership, (row) => row.id);
}

function readIndex(indexPath) {
  return readJson(indexPath);
}

function writeIndex(indexPath, payload) {
  writeJson(indexPath, payload);
}

function indexRepositories(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const cfg = loadSearchConfig(configPath);
  const outputDir = path.resolve(options.outputDir || path.join(repositoryRoot, cfg.defaults?.indexDir || DEFAULT_INDEX_DIR));
  const indexPath = path.join(outputDir, options.outputFile || DEFAULT_INDEX_FILE);

  const sourcebot = (options.preferSourcebot ? loadSourcebotProvider(configPath) : null);
  if (sourcebot && sourcebot.isAvailable(cfg) && options.preferSourcebot) {
    const result = sourcebot.indexRepositories(repositoryRoot, indexPath, {
      outputPath: indexPath,
      providerConfig: cfg.provider || {},
      limit: options.limit,
    });
    if (result && result.available && !result.error) {
      const payload = {
        generatedAt: new Date().toISOString(),
        repositoryRoot,
        source: "sourcebot",
        configPath: path.resolve(configPath),
        generatedBy: "sourcebot",
        stats: {
          symbols: 0,
          files: 0,
          references: 0,
          callers: 0,
        },
        repos: [],
        symbols: [],
        references: [],
        callers: [],
        implementations: [],
        apiUsages: [],
        ownership: collectOwnerSignals(cfg, repositoryRoot, findRepos(repositoryRoot)),
      };
      writeIndex(indexPath, { ...payload, raw: result.results });
      return { indexPath, source: "sourcebot", generated: true, count: 0 };
    }
  }

  const repos = findRepos(repositoryRoot);
  const repoPayloads = [];
  for (const repo of repos) {
    const repoAbs = path.resolve(repositoryRoot, repo.path || ".");
    const metadata = collectIndexMetadata(repoAbs, cfg, [{ ...repo, path: path.relative(repositoryRoot, repoAbs).replace(/\\/g, "/") }]);
    repoPayloads.push({
      repo,
      ...metadata,
    });
  }
  const aggregate = {
    generatedAt: new Date().toISOString(),
    repositoryRoot,
    source: "local",
    configPath: path.resolve(configPath),
    repos: repos.map((repo) => repo.id),
    files: repoPayloads.flatMap((row) => row.files),
    symbols: uniqueBy(repoPayloads.flatMap((row) => row.symbols), (row) => `${row.repository}|${row.file}|${row.symbol}|${row.line}`),
    references: [],
    callers: [],
    implementations: [],
    apiUsages: uniqueBy(repoPayloads.flatMap((row) => row.apiUsages), (row) => `${row.repository}|${row.file}|${row.line}|${row.symbol}`),
    ownership: collectOwnerSignals(cfg, repositoryRoot, repos),
  };
  const relationships = collectReferencesAndCallers(cfg, repoPayloads);
  aggregate.references = relationships.references;
  aggregate.callers = relationships.callers;
  aggregate.implementations = buildImplementations(aggregate.symbols);
  writeIndex(indexPath, aggregate);
  return {
    indexPath,
    source: "local",
    count: aggregate.files.length,
    generated: true,
    repositories: repos.map((repo) => repo.id),
  };
}

function getIndex(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const indexPath = path.resolve(options.outputDir || path.join(repositoryRoot, cfg.defaults?.indexDir || DEFAULT_INDEX_DIR), options.indexFile || DEFAULT_INDEX_FILE);
  const index = readIndex(indexPath);
  if (!index) {
    throw new Error(`Index missing: ${indexPath}`);
  }
  return index;
}

function normalizeSearchResult(query, type, row) {
  const line = Number(row.line || 0);
  const location = row.location || `${row.file || row.path || ""}:${line || "?"}`;
  return {
    repository: row.repository || row.repo || ".",
    file: row.file || row.path || "",
    symbol: row.symbol || row.name || "",
    location,
    score: Number(row.score || 0),
    reason: row.reason || `${type} match`,
    type,
    query,
    line,
  };
}

function searchSymbol(options = {}) {
  const query = String(options.symbolName || options.query || "").trim();
  if (!query) throw new Error("search-symbol requires a symbol query");
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : cfg.defaults.maxResults;

  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchSymbol === "function") {
    const result = sourcebot.searchSymbol(repositoryRoot, query, { limit });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      const rows = result.results
        .filter((row) => String(row.symbol || "").toLowerCase().includes(query.toLowerCase()))
        .map((row) => ({ ...row, type: "symbol", query, score: Number(row.score || 0) || 0.95 }));
      return {
        query,
        type: "symbol",
        source: "sourcebot",
        results: rows
          .sort((a, b) => b.score - a.score || String(a.file).localeCompare(String(b.file)))
          .slice(0, limit)
          .map((row) => normalizeSearchResult(query, "symbol", row)),
      };
    }
  }

  const index = getIndex(options);
  const rows = [];
  const symbols = Array.isArray(index.symbols) ? index.symbols : [];
  const lower = query.toLowerCase();
  for (const row of symbols) {
    const symbol = String(row.symbol || "");
    const lowered = symbol.toLowerCase();
    if (!lowered.includes(lower)) continue;
    const exact = lowered === lower;
    const score = exact ? (cfg.weights?.exactSymbol || 1) : (cfg.weights?.exactSymbol || 1) * 0.6;
    const refs = referencesBySymbol(index.references, row.symbol, row.repository, row.file);
    const callees = callersBySymbol(index.callers, row.symbol, row.repository, row.file);
    rows.push({
      repository: row.repository,
      file: row.file,
      symbol,
      type: "symbol",
      score,
      reason: exact ? "exact symbol match" : "partial symbol match",
      location: `${row.file}:${row.line}`,
      line: row.line,
      query,
      references: refs.slice(0, 5).map((item) => `${item.repository}/${item.file}:${item.line}`),
      callers: callees.slice(0, 5).map((item) => `${item.repository}/${item.file}:${item.line}`),
      implementations: implementationRowsBySymbol(index.implementations, row.symbol).slice(0, 3).map((row) => `${row.repository}/${row.file}:${row.line}`),
    });
  }
  const exactFirst = rows.filter((row) => row.reason.includes("exact")).sort(byScore);
  const partial = rows.filter((row) => !row.reason.includes("exact")).sort(byScore);
  return {
    query,
    type: "symbol",
    source: "local",
    results: [...exactFirst, ...partial].slice(0, limit).map((row) => normalizeSearchResult(query, "symbol", row)),
  };
}

function byScore(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return String(a.repository).localeCompare(String(b.repository)) || String(a.file).localeCompare(String(b.file));
}

function referencesBySymbol(refs, symbol, repository, file) {
  return (Array.isArray(refs) ? refs : []).filter((row) => String(row.symbol || "").toLowerCase() === String(symbol || "").toLowerCase()
    && String(row.repository || "") === String(repository || "")
    && String(row.file || "") !== String(file || ""));
}

function callersBySymbol(callers, symbol, repository, file) {
  return (Array.isArray(callers) ? callers : []).filter((row) => String(row.symbol?.symbol || row.symbol || "").toLowerCase() === String(symbol || "").toLowerCase()
    && String(row.repository || "") === String(repository || "")
    && String(row.file || "") !== String(file || ""));
}

function implementationRowsBySymbol(implRows, symbol) {
  return (Array.isArray(implRows) ? implRows : []).filter((row) => {
    return String(row.implemented || "").toLowerCase() === String(symbol || "").toLowerCase()
      || String(row.symbol || "").toLowerCase() === String(symbol || "").toLowerCase();
  });
}

function referencesInIndex(index, query, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : (loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH).defaults.maxResults);
  const refs = (index.references || []).filter((row) => String(row.symbol || "").toLowerCase() === String(query || "").toLowerCase());
  return {
    query,
    type: "reference",
    source: "local",
    results: refs
      .map((row) => normalizeSearchResult(query, "reference", row))
      .sort(byScore)
      .slice(0, limit),
  };
}

function searchReferences(options = {}) {
  const query = String(options.symbol || options.query || "").trim();
  if (!query) throw new Error("search-references requires a symbol");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchReferences === "function") {
    const result = sourcebot.searchReferences(path.resolve(options.repositoryRoot || process.cwd()), query, { limit: Number(options.limit || cfg.defaults.maxResults) });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      return {
        query,
        type: "reference",
        source: "sourcebot",
        results: result.results
          .map((row) => normalizeSearchResult(query, "reference", row))
          .sort(byScore)
          .slice(0, Number(options.limit || cfg.defaults.maxResults)),
      };
    }
  }
  const qLower = query.toLowerCase();
  const rows = (Array.isArray(index.references) ? index.references : []).filter((row) => String(row.symbol || "").toLowerCase() === qLower);
  const results = rows
    .map((row) => ({
      ...row,
      score: row.score || scoreMatch(qLower, `${row.file} ${row.snippet}`, 0.4, 0.3),
      reason: "reference match",
    }))
    .sort(byScore)
    .slice(0, Number(options.limit || cfg.defaults.maxResults))
    .map((row) => normalizeSearchResult(query, "reference", { ...row, file: row.file || row.path }));
  return { query, type: "reference", source: "local", results };
}

function searchCallers(options = {}) {
  const query = String(options.symbol || options.query || "").trim();
  if (!query) throw new Error("search-callers requires a symbol");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchCallers === "function") {
    const result = sourcebot.searchCallers(path.resolve(options.repositoryRoot || process.cwd()), query, { limit: Number(options.limit || cfg.defaults.maxResults) });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      return {
        query,
        type: "caller",
        source: "sourcebot",
        results: result.results.map((row) => ({
          repository: row.repository || row.repo || ".",
          file: row.file || row.path || "",
          symbol: row.symbol || query,
          location: row.callPath || `${row.file || row.path}:${row.line}`,
          score: Number(row.score || 0),
          reason: row.reason || "caller match",
        })).sort(byScore).slice(0, Number(options.limit || cfg.defaults.maxResults)),
      };
    }
  }
  const qLower = query.toLowerCase();
  const rows = (Array.isArray(index.callers) ? index.callers : [])
    .filter((row) => String(row.symbol?.symbol || row.symbol || "").toLowerCase() === qLower)
    .map((row) => ({
      repository: row.repository,
      file: row.file,
      symbol: row.callerSymbol || row.symbol?.symbol,
      location: row.callPath || row.location,
      score: row.score || 0.5,
      reason: "caller match",
      line: row.line,
    }));
  return { query, type: "caller", source: "local", results: rows.sort(byScore).slice(0, Number(options.limit || cfg.defaults.maxResults)) };
}

function searchImplementations(options = {}) {
  const query = String(options.symbol || options.query || "").trim();
  if (!query) throw new Error("search-implementations requires a symbol");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchImplementations === "function") {
    const result = sourcebot.searchImplementations(path.resolve(options.repositoryRoot || process.cwd()), query, { limit: Number(options.limit || cfg.defaults.maxResults) });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      return {
        query,
        type: "implementation",
        source: "sourcebot",
        results: result.results
          .map((row) => normalizeSearchResult(query, "implementation", row))
          .sort(byScore)
          .slice(0, Number(options.limit || cfg.defaults.maxResults)),
      };
    }
  }
  const qLower = query.toLowerCase();
  const rows = (index.implementations || [])
    .filter((row) => {
      return String(row.implemented || "").toLowerCase() === qLower
        || String(row.symbol || "").toLowerCase() === qLower;
    })
    .map((row) => ({
      repository: row.repository,
      file: row.file,
      symbol: row.symbol,
      location: `${row.file}:${row.line}`,
      score: row.score || 0.6,
      reason: row.kind === "implements" ? "implements interface or protocol" : "extends type",
      line: row.line,
    }));
  return { query, type: "implementation", source: "local", results: rows.sort(byScore).slice(0, Number(options.limit || cfg.defaults.maxResults)) };
}

function searchApiUsage(options = {}) {
  const query = String(options.query || options.api || "").trim();
  if (!query) throw new Error("search-api-usage requires a query");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchApiUsage === "function") {
    const result = sourcebot.searchApiUsage(path.resolve(options.repositoryRoot || process.cwd()), query, { limit: Number(options.limit || cfg.defaults.maxResults) });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      return {
        query,
        type: "api",
        source: "sourcebot",
        results: result.results
          .map((row) => normalizeSearchResult(query, "api", row))
          .sort(byScore)
          .slice(0, Number(options.limit || cfg.defaults.maxResults)),
      };
    }
  }
  const qLower = query.toLowerCase();
  const rows = (index.apiUsages || [])
    .filter((row) => String(row.symbol || "").toLowerCase().includes(qLower))
    .map((row) => ({
      repository: row.repository,
      file: row.file,
      symbol: row.symbol,
      location: `${row.file}:${row.line}`,
      score: scoreMatch(qLower, `${row.kind} ${row.symbol} ${row.snippet}`, 0.2, 0.3),
      reason: `${row.kind || "usage"} usage match`,
      line: row.line,
    }));
  return { query, type: "api", source: "local", results: rows.sort(byScore).slice(0, Number(options.limit || cfg.defaults.maxResults)) };
}

function searchCrossRepository(options = {}) {
  const query = String(options.query || options.symbol || "").trim();
  if (!query) throw new Error("search-cross-repository requires a query");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : cfg.defaults.maxResults;
  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchCrossRepository === "function") {
    const result = sourcebot.searchCrossRepository(path.resolve(options.repositoryRoot || process.cwd()), query, { limit });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      return {
        query,
        type: "cross-repository",
        source: "sourcebot",
        results: result.results
          .map((row) => normalizeSearchResult(query, "cross-repository", row))
          .sort(byScore)
          .slice(0, limit),
      };
    }
  }
  const qLower = query.toLowerCase();
  const qTokens = tokenSet(qLower);
  const fileRows = Array.isArray(index.files) ? index.files : [];
  const symbolRows = Array.isArray(index.symbols) ? index.symbols : [];
  const apiRows = Array.isArray(index.apiUsages) ? index.apiUsages : [];
  const merged = [];
  for (const row of symbolRows) {
    const score = overlap(qTokens, tokenSet(`${row.symbol} ${row.kind} ${row.file}`)) + 0.1;
    if (score > 0.1) merged.push({
      repository: row.repository,
      file: row.file,
      symbol: row.symbol,
      location: `${row.file}:${row.line}`,
      score: Math.min(1, score * (cfg.weights?.crossRepo || 1)),
      reason: "cross repository symbol match",
      line: row.line,
      query,
    });
  }
  for (const row of apiRows) {
    const score = overlap(qTokens, tokenSet(`${row.symbol} ${row.kind}`));
    if (score > 0.1) {
      merged.push({
        repository: row.repository,
        file: row.file,
        symbol: row.symbol,
        location: `${row.file}:${row.line}`,
        score: Math.min(1, score * (cfg.weights?.api || 1)),
        reason: "cross repository api usage match",
        line: row.line,
        query,
      });
    }
  }
  for (const row of fileRows) {
    const score = overlap(qTokens, tokenSet(`${row.file} ${row.path || ""}`));
    if (score > 0.1 && qLower.includes(".") === false) {
      merged.push({
        repository: row.repository,
        file: row.file,
        symbol: path.basename(row.file),
        location: row.file,
        score: Math.min(1, score * (cfg.weights?.crossRepo || 1)),
        reason: "cross repository file match",
        query,
      });
    }
  }
  const deduped = uniqueBy(merged, (row) => `${row.repository}|${row.file}|${row.symbol}`);
  deduped.sort((a, b) => b.score - a.score || String(a.repository).localeCompare(String(b.repository)));
  return {
    query,
    type: "cross-repository",
    source: "local",
    results: deduped.slice(0, limit).map((row) => normalizeSearchResult(query, "cross-repository", row)),
  };
}

function searchOwner(options = {}) {
  const query = String(options.query || options.owner || "").trim().toLowerCase();
  if (!query) throw new Error("search-owner requires a query");
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const index = getIndex(options);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : cfg.defaults.maxResults;

  const sourcebot = options.preferSourcebot && loadSourcebotProvider(options.configPath || DEFAULT_CONFIG_PATH);
  if (sourcebot && sourcebot.isAvailable(cfg) && typeof sourcebot.searchOwner === "function") {
    const result = sourcebot.searchOwner(path.resolve(options.repositoryRoot || process.cwd()), query, { limit });
    if (result && result.available && Array.isArray(result.results) && result.results.length > 0) {
      const mapped = result.results.map((row) => ({
        repository: row.repository || row.repo || ".",
        file: row.file || "ownership",
        symbol: `owner:${row.symbol || row.owner || ""}`,
        location: row.location || "ownership",
        score: Number(row.score || 0.8),
        reason: "sourcebot ownership match",
      }));
      return { query, type: "owner", source: "sourcebot", results: mapped.sort(byScore).slice(0, limit) };
    }
  }
  const ownerRows = [];
  const artifacts = Array.isArray(index.ownership) ? index.ownership : [];
  for (const row of artifacts) {
    const haystack = `${row.repository} ${row.owner} ${row.team} ${(row.responsibilities || []).join(" ")} ${(row.task || "")} ${(row.id || "")}`.toLowerCase();
    if (!haystack.includes(query)) continue;
    const score = scoreMatch(query, haystack, 0.3, 0.3);
    ownerRows.push({
      repository: row.repository,
      file: row.task ? `task:${row.task}` : "ownership",
      symbol: row.owner || row.team || row.repository,
      location: row.repository,
      score: Math.max(0.2, score),
      reason: `ownership match from ${row.sources?.join(",") || "metadata"}`,
      query,
    });
  }
  ownerRows.sort(byScore);
  return {
    query,
    type: "owner",
    source: "local",
    results: ownerRows.slice(0, limit),
  };
}

function validateSearchState(options = {}) {
  const cfg = loadSearchConfig(options.configPath || DEFAULT_CONFIG_PATH);
  const result = {
    generatedAt: new Date().toISOString(),
    valid: true,
    failures: [],
    counts: {},
  };
  const indexPath = path.resolve(options.outputDir || path.join(process.cwd(), cfg.defaults.indexDir || DEFAULT_INDEX_DIR), options.indexFile || DEFAULT_INDEX_FILE);
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  result.indexPath = indexPath;
  const payload = readIndex(indexPath);
  if (!payload) {
    result.valid = false;
    result.failures.push(`missing index: ${indexPath}`);
    return result;
  }

  const required = ["files", "symbols", "references", "callers", "implementations", "apiUsages"];
  for (const key of required) {
    if (!Array.isArray(payload[key])) {
      result.valid = false;
      result.failures.push(`invalid index section: ${key}`);
    }
  }

  const fileById = new Set();
  let danglingFile = 0;
  for (const row of payload.files || []) {
    if (fileById.has(row.id)) {
      result.failures.push(`duplicate file id: ${row.id}`);
      result.valid = false;
    } else {
      fileById.add(row.id);
    }
    if (row.repository && row.file) {
      const abs = path.join(repositoryRoot, row.repository, row.file.replace(`${row.repository}/`, ""));
      if (!fs.existsSync(abs)) {
        danglingFile += 1;
      }
    }
    if (row.path && String(row.location || "").includes("..")) {
      result.failures.push(`suspicious file path: ${row.path}`);
      result.valid = false;
    }
  }
  if (danglingFile > 0) {
    result.failures.push(`dangling files in index: ${danglingFile}`);
    result.valid = false;
  }
  const symbolByKey = new Set();
  for (const row of payload.symbols || []) {
    const key = `${row.repository}|${row.file}|${row.symbol}`;
    if (symbolByKey.has(key)) {
      result.failures.push(`duplicate symbol entry: ${key}`);
      result.valid = false;
    } else {
      symbolByKey.add(key);
    }
    if (!row.symbol) {
      result.failures.push(`symbol missing name in ${row.repository}`);
      result.valid = false;
    }
  }
  result.counts = {
    files: payload.files?.length || 0,
    symbols: payload.symbols?.length || 0,
    references: payload.references?.length || 0,
    callers: payload.callers?.length || 0,
    implementations: payload.implementations?.length || 0,
    apiUsages: payload.apiUsages?.length || 0,
  };
  return result;
}

function updateSearchIndex(options = {}) {
  return indexRepositories(options);
}

function normalizeProfile(raw = {}) {
  return {
    name: raw?.name || "coder",
    maxResults: raw?.maxResults || 25,
  };
}

module.exports = {
  loadSearchConfig,
  indexRepositories,
  updateSearchIndex,
  searchSymbol,
  searchReferences,
  searchCallers,
  searchImplementations,
  searchApiUsage,
  searchCrossRepository,
  searchOwner,
  validateSearchState,
};
