const childProcess = require("node:child_process");

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = childProcess.spawnSync(checker, [command], { encoding: "utf8" });
  return result.status === 0;
}

function parseJsonOutput(output) {
  if (!output) return null;
  try {
    return JSON.parse(String(output));
  } catch {
    return null;
  }
}

function run(sourcebotBinary, args, cwd) {
  const result = childProcess.spawnSync(sourcebotBinary, args, {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function toRows(payload, type, repositoryRoot, fallback = []) {
  if (!payload || !Array.isArray(payload.results)) return fallback;
  return payload.results.map((row) => ({
    type,
    repository: row.repository || ".",
    file: row.file || row.path || "",
    symbol: row.symbol || "",
    line: Number(row.line || 0),
    snippet: row.snippet || "",
    source: "sourcebot",
    score: Number(row.score || 0),
    reason: row.reason || `sourcebot ${type} result`,
    location: row.location || null,
    path: row.path || "",
    related: row.related || [],
  }));
}

function mapToResult(result, options = {}) {
  if (!result || !result.available) return [];
  return {
    available: true,
    path: options.outputPath || null,
    command: options.command || null,
    results: result.results || [],
  };
}

function isAvailable(config) {
  const binary = process.env.SOURCEBOT_BIN || config?.binary || "sourcebot";
  return commandExists(binary);
}

function indexRepositories(repositoryRoot, outputPath, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["index", "--root", repositoryRoot, "--output", outputPath, "--format", "json"];
  if (providerConfig.extraArgs) args.push(...providerConfig.extraArgs);
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot index failed", results: [] };
  }
  const parsed = parseJsonOutput(executed.stdout);
  return { available: true, results: parsed || [], command: `${binary} ${args.join(" ")}` };
}

function searchSymbol(repositoryRoot, query, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["search", "symbol", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
  }
  return { available: true, results: toRows(parseJsonOutput(executed.stdout), "symbol", repositoryRoot), command: `${binary} ${args.join(" ")}` };
}

function searchReferences(repositoryRoot, query, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["search", "references", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
  }
  return {
    available: true,
    results: toRows(parseJsonOutput(executed.stdout), "reference", repositoryRoot),
    command: `${binary} ${args.join(" ")}`,
  };
}

function searchCallers(repositoryRoot, query, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["search", "callers", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
  }
  return {
    available: true,
    results: toRows(parseJsonOutput(executed.stdout), "caller", repositoryRoot),
    command: `${binary} ${args.join(" ")}`,
  };
}

function searchImplementations(repositoryRoot, query, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["search", "implementations", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
  }
  return {
    available: true,
    results: toRows(parseJsonOutput(executed.stdout), "implementation", repositoryRoot),
    command: `${binary} ${args.join(" ")}`,
  };
}

function searchApiUsage(repositoryRoot, query, options = {}) {
  const providerConfig = options.providerConfig || {};
  const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
  if (!commandExists(binary)) {
    return { available: false, error: "sourcebot binary unavailable", results: [] };
  }
  const args = ["search", "api", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
  const executed = run(binary, args, repositoryRoot);
  if (executed.status !== 0) {
    return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
  }
  return {
    available: true,
    results: toRows(parseJsonOutput(executed.stdout), "api", repositoryRoot),
    command: `${binary} ${args.join(" ")}`,
  };
}

module.exports = {
  isAvailable,
  indexRepositories,
  searchSymbol,
  searchReferences,
  searchCallers,
  searchImplementations,
  searchApiUsage,
  searchCrossRepository(repositoryRoot, query, options = {}) {
    const providerConfig = options.providerConfig || {};
    const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
    if (!commandExists(binary)) {
      return { available: false, error: "sourcebot binary unavailable", results: [] };
    }
    const args = ["search", "cross", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
    const executed = run(binary, args, repositoryRoot);
    if (executed.status !== 0) {
      return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
    }
    return {
      available: true,
      results: toRows(parseJsonOutput(executed.stdout), "cross-repository", repositoryRoot),
      command: `${binary} ${args.join(" ")}`,
    };
  },
  searchOwner(repositoryRoot, query, options = {}) {
    const providerConfig = options.providerConfig || {};
    const binary = process.env.SOURCEBOT_BIN || providerConfig.binary || "sourcebot";
    if (!commandExists(binary)) {
      return { available: false, error: "sourcebot binary unavailable", results: [] };
    }
    const args = ["search", "owner", "--query", String(query || ""), "--limit", String(options.limit || 20), "--format", "json"];
    const executed = run(binary, args, repositoryRoot);
    if (executed.status !== 0) {
      return { available: true, error: executed.stderr || "sourcebot search failed", results: [] };
    }
    return {
      available: true,
      results: toRows(parseJsonOutput(executed.stdout), "owner", repositoryRoot),
      command: `${binary} ${args.join(" ")}`,
    };
  },
};
