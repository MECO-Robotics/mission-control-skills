const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "observability-config.json");
const DEFAULT_PROMPT_REGISTRY_PATH = path.join(__dirname, "..", "prompts", "registry.json");
const TRACE_INDEX_FILE = "trace-index.json";

const DEFAULT_SCHEMA = {
  required: [
    "trace_id",
    "timestamp",
    "task_id",
    "repository",
    "agent_role",
    "operation",
    "prompt_id",
    "prompt_version",
    "context_package",
    "input_summary",
    "output_summary",
    "related_prs",
    "related_findings",
    "related_evaluations",
    "metadata",
  ],
};

const SECRET_KEYS = [
  /api[_-]?key/i,
  /apikey/i,
  /auth.?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /ssh[_-]?key/i,
  /credential/i,
];

const SECRET_VALUES = [
  /sk_live_[A-Za-z0-9]{10,}/i,
  /xox[baprs]-[A-Za-z0-9-]{10,}/i,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{10,}/i,
  /gho_[A-Za-z0-9]{10,}/i,
  /eyJ[a-zA-Z0-9_\-\.]{20,}/,
];

let TRACE_SEQUENCE = 0;

function now() {
  return new Date().toISOString();
}

function toPosix(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function deterministicHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function makeTraceId(seed) {
  TRACE_SEQUENCE += 1;
  return deterministicHash(`${seed || "trace"}-${process.pid}-${now()}-${TRACE_SEQUENCE}`).slice(0, 24);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const normalized = String(raw).replace(/^\uFEFF/, "").trimStart();
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readTrace(filePath) {
  return readJson(filePath);
}

function loadModuleIfExists(modulePath) {
  if (!fs.existsSync(modulePath)) return null;
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

function loadRepositoryIntelligence() {
  return loadModuleIfExists(path.resolve(__dirname, "..", "..", "repository-intelligence", "src", "engine.js"));
}

function loadGraphify() {
  return loadModuleIfExists(path.resolve(__dirname, "..", "..", "graphify", "src", "engine.js"));
}

function loadStaticAnalysis() {
  return loadModuleIfExists(path.resolve(__dirname, "..", "..", "static-analysis", "src", "engine.js"));
}

function loadEvaluationEngine() {
  return loadModuleIfExists(path.resolve(__dirname, "..", "..", "evaluation", "src", "engine.js"));
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const payload = readJson(configPath);
  if (!payload) {
    return {
      providers: {},
      defaults: {
        provider: "local",
        send_remote_by_default: false,
        trace_dir: path.join(process.cwd(), "observability", "traces"),
        include_secret_redaction: true,
      },
    };
  }
  return payload;
}

function loadPromptRegistry(registryPath = DEFAULT_PROMPT_REGISTRY_PATH) {
  return readJson(registryPath) || { prompts: [] };
}

function normalizeProfile(value) {
  return String(value || "coder");
}

function findPromptEntry(promptRegistry, promptId) {
  if (!promptRegistry || !Array.isArray(promptRegistry.prompts)) return null;
  return promptRegistry.prompts.find((row) => String(row.id) === String(promptId));
}

function resolvePromptVersion(promptRegistry, promptId, versionHint) {
  const entry = findPromptEntry(promptRegistry, promptId);
  if (versionHint) return String(versionHint);
  if (entry?.version) return String(entry.version);
  return "unknown";
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasSecretIndicators(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return SECRET_VALUES.some((pattern) => pattern.test(text));
}

function shouldRedactKey(key = "") {
  return SECRET_KEYS.some((pattern) => pattern.test(String(key)));
}

function redactValue(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    for (const pattern of SECRET_VALUES) {
      if (pattern.test(normalized)) return "[REDACTED]";
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    return value.map((row) => redactValue(row));
  }
  if (isObject(value)) {
    return redactObject(value);
  }
  return value;
}

function redactObject(input) {
  if (input == null) return input;
  if (Array.isArray(input)) {
    return input.map((row) => redactObject(row));
  }
  if (isObject(input)) {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (shouldRedactKey(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redactValue(value);
    }
    return out;
  }
  return redactValue(input);
}

function validateTrace(trace) {
  const missing = [];
  if (!trace || typeof trace !== "object") return { valid: false, missing: ["trace-object"] };
  for (const required of DEFAULT_SCHEMA.required) {
    if (trace[required] == null) {
      missing.push(required);
      continue;
    }
    if (
      ["related_prs", "related_findings", "related_evaluations"].includes(required)
      && !Array.isArray(trace[required])
    ) {
      missing.push(required);
    }
  }
  if (hasSecretIndicators(trace)) missing.push("secret_redaction");
  return { valid: missing.length === 0, missing };
}

function parseJsonList(input) {
  if (Array.isArray(input)) return input;
  if (!input) return [];
  if (typeof input === "string") {
    const filePath = path.resolve(input);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const parsed = readJson(filePath);
      return Array.isArray(parsed) ? parsed : [];
    }
    if (input.includes(",")) return input.split(",").map((row) => row.trim()).filter(Boolean);
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function listFiles(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const out = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(root, childRel);
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        out.push(childRel.replace(/\\/g, "/"));
      }
    }
  }
  out.sort();
  return out;
}

function traceFilePath(traceDir, traceId) {
  return path.join(traceDir, `${traceId}.json`);
}

function traceIndexPath(tracesDir) {
  return path.join(path.resolve(tracesDir, ".."), TRACE_INDEX_FILE);
}

function readTraceIndex(tracesDir) {
  const indexPath = traceIndexPath(tracesDir);
  return readJson(indexPath) || { generated_at: now(), traces: [] };
}

function writeTraceIndex(tracesDir, payload) {
  const indexPath = traceIndexPath(tracesDir);
  writeJson(indexPath, payload);
}

function updateTraceIndex(tracesDir, trace) {
  const index = readTraceIndex(tracesDir);
  const entries = Array.isArray(index.traces) ? [...index.traces] : [];
  const next = {
    trace_id: trace.trace_id,
    timestamp: trace.timestamp,
    task_id: trace.task_id,
    repository: trace.repository,
    agent_role: trace.agent_role,
    operation: trace.operation,
    prompt_id: trace.prompt_id,
    prompt_version: trace.prompt_version,
    context_package: trace.context_package,
    related_prs: [...(trace.related_prs || [])],
    related_findings: [...(trace.related_findings || [])],
    related_evaluations: [...(trace.related_evaluations || [])],
  };

  const existingIndex = entries.findIndex((row) => row.trace_id === trace.trace_id);
  if (existingIndex >= 0) {
    entries[existingIndex] = next;
  } else {
    entries.push(next);
  }
  entries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const payload = { generated_at: now(), traces: entries };
  writeTraceIndex(tracesDir, payload);
  return payload;
}

function collectMetadataFromRepo(root) {
  const out = {
    repositories: [],
    tasks: [],
    dependencies: [],
    estimated_tokens: 0,
    source: "local",
  };

  const tokenReport = readJson(path.join(root, "generated-context", "token-report.json"));
  if (tokenReport && Number.isFinite(Number(tokenReport.estimated_tokens))) {
    out.estimated_tokens = Number(tokenReport.estimated_tokens);
  }

  const dependencyMap = readJson(path.join(root, "dependency-map.json"));
  if (Array.isArray(dependencyMap?.dependencies)) {
    out.dependencies = dependencyMap.dependencies
      .map((row) => ({
        from: row.from || row.fromTask || null,
        to: row.to || row.toTask || null,
        type: row.type || "depends_on",
        repository: row.repository || null,
      }))
      .filter((row) => row.from || row.to);
  }

  const issues = readJson(path.join(root, "global-issues.json"));
  if (Array.isArray(issues?.tasks)) {
    out.tasks = issues.tasks.map((row) => String(row.id || "").trim()).filter(Boolean);
  }

  const repoRegistry = readJson(path.join(root, "repo-registry.json"));
  if (Array.isArray(repoRegistry?.repositories)) {
    out.repositories = repoRegistry.repositories
      .map((row) => row.id || row.name || row.path)
      .filter(Boolean);
  } else if (isObject(repoRegistry?.repositories)) {
    out.repositories = Object.keys(repoRegistry.repositories);
  } else if (Array.isArray(repoRegistry)) {
    out.repositories = repoRegistry.map((row) => row.id || row.name || row.path).filter(Boolean);
  }
  return out;
}

function collectTaskAndRepoEvidence(root) {
  const issues = readJson(path.join(root, "global-issues.json"));
  const map = readJson(path.join(root, "dependency-map.json"));
  const tasks = [];
  const dependencies = [];
  if (Array.isArray(issues?.tasks)) {
    for (const task of issues.tasks) {
      if (!task || !task.id) continue;
      tasks.push(String(task.id));
    }
  }
  if (Array.isArray(map?.dependencies)) {
    for (const dep of map.dependencies) {
      dependencies.push({
        from: dep.from || dep.fromTask || "",
        to: dep.to || dep.toTask || "",
        type: dep.type || "depends_on",
      });
    }
  }
  return { tasks, dependencies };
}

function gatherTaskIdsFromContext(contextPath, repoRoot) {
  const tokenReport = readJson(path.join(contextPath, "token-report.json"));
  if (Array.isArray(tokenReport?.tasks)) return tokenReport.tasks;
  const issueFile = readJson(path.join(repoRoot, "global-issues.json"));
  if (Array.isArray(issueFile?.tasks)) return issueFile.tasks.map((row) => row.id).filter(Boolean);
  return [];
}

function formatFinding(finding) {
  return {
    id: finding.id || `${finding.rule || "finding"}-${finding.line || 0}`,
    file: finding.file || "",
    repository: finding.repository || "",
    severity: finding.severity || "info",
    rule: finding.rule || "",
    message: finding.message || "",
  };
}

function severityRank(value) {
  const normalized = String(value || "info").toLowerCase();
  if (normalized === "critical") return 5;
  if (normalized === "high") return 4;
  if (normalized === "medium") return 3;
  if (normalized === "low") return 2;
  return 1;
}

function readFindingSet(filePath) {
  const payload = readJson(filePath);
  if (!payload || !Array.isArray(payload.findings)) return [];
  return payload.findings.map(formatFinding);
}

function diffFindingLists(before = [], after = []) {
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const afterById = new Map(after.map((row) => [row.id, row]));
  const introduced = [];
  const resolved = [];
  const severityIncreases = [];
  for (const [id, next] of afterById.entries()) {
    if (!beforeById.has(id)) {
      introduced.push(next);
      continue;
    }
    const prev = beforeById.get(id);
    if (severityRank(next.severity) > severityRank(prev.severity)) {
      severityIncreases.push({
        findingId: id,
        previous: prev.severity || "info",
        current: next.severity || "info",
      });
    }
  }
  for (const [id, prev] of beforeById.entries()) {
    if (!afterById.has(id)) resolved.push(prev);
  }
  return { introduced, resolved, severityIncreases };
}

function loadProvider(name) {
  const provider = String(name || "local").toLowerCase();
  if (provider === "langfuse") {
    return loadModuleIfExists(path.join(__dirname, "..", "providers", "langfuse", "index.js"));
  }
  return null;
}

function buildContextMeta(root) {
  const evidence = collectMetadataFromRepo(root);
  return {
    generated_at: now(),
    repositories: evidence.repositories,
    tasks: evidence.tasks,
    dependencies: evidence.dependencies,
    estimated_tokens: evidence.estimated_tokens,
    source: "local",
  };
}

function makeTrace(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const promptRegistry = loadPromptRegistry(options.promptRegistry);
  const promptId = options.promptId || "default";
  const taskId = String(options.taskId || "").toUpperCase();
  const traceId = options.traceId || makeTraceId(`${taskId}|${options.agentRole || ""}|${options.operation || ""}|${options.promptId || ""}`);
  const metadata = { ...buildContextMeta(repositoryRoot), ...(options.metadata || {}) };

  const trace = {
    trace_id: traceId,
    timestamp: options.timestamp || now(),
    task_id: taskId,
    repository: options.repository || repositoryRoot,
    agent_role: options.agentRole || options.role || "architect",
    operation: options.operation || "agent-run",
    prompt_id: promptId,
    prompt_version: resolvePromptVersion(promptRegistry, promptId, options.promptVersion),
    context_package: options.contextPackage || options.contextPath || null,
    input_summary: String(options.inputSummary || ""),
    output_summary: String(options.outputSummary || ""),
    related_prs: Array.isArray(options.relatedPrs) ? [...options.relatedPrs] : [],
    related_findings: Array.isArray(options.relatedFindings) ? [...options.relatedFindings] : [],
    related_evaluations: Array.isArray(options.relatedEvaluations) ? [...options.relatedEvaluations] : [],
    metadata,
  };
  return redactObject(trace);
}

function writeTrace(trace, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const observableRoot = path.resolve(options.observabilityRoot || path.join(repositoryRoot, "observability"));
  const traceDir = path.join(observableRoot, "traces");
  const tracePath = traceFilePath(traceDir, trace.trace_id);
  writeJson(tracePath, trace);
  const traceIndex = updateTraceIndex(traceDir, trace);
  return {
    ...trace,
    tracePath,
    traceIndexPath: traceIndexPath(traceDir),
    index: traceIndex,
  };
}

function recordTrace(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const trace = makeTrace({ ...options, repositoryRoot });
  const payload = writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
  const cfg = loadConfig(options.configPath);
  const providerName = options.provider || cfg.defaults?.provider || "local";
  const providerCfg = cfg.providers?.[providerName] || {};
  const provider = loadProvider(providerName);
  if (provider?.exportTraces && (options.sendRemote || providerCfg.sendRemote || cfg.defaults?.send_remote_by_default)) {
    payload.provider_export = provider.exportTraces({
      traces: [trace],
      repositoryRoot,
      outputPath: options.outputPath || path.join(repositoryRoot, "observability", "langfuse-export.json"),
      sendRemote: false,
      ...providerCfg,
    });
  }
  return payload;
}

function gatherRepoIntelligenceOutput(root, query, profile, taskId, limit = 10) {
  const engine = loadRepositoryIntelligence();
  if (!engine || typeof engine.find_context_for_task !== "function") {
    return { files: [], symbols: [], decisions: [], tasks: [], ranking: {} };
  }
  try {
    const result = engine.find_context_for_task({ repositoryRoot: root, taskId, query, profile: profile || "reviewer", limit });
    return {
      files: result.files || [],
      symbols: result.symbols || [],
      decisions: result.decisions || [],
      tasks: result.relatedTasks || result.tasks || [],
      ranking: {
        files: (result.files || []).length,
        decisions: (result.decisions || []).length,
        tasks: (result.relatedTasks || result.tasks || []).length,
      },
    };
  } catch {
    return { files: [], symbols: [], decisions: [], tasks: [], ranking: {} };
  }
}

function gatherGraphOutput(root, query, profile, taskId, limit = 10) {
  const engine = loadGraphify();
  if (!engine || typeof engine.queryProjectGraph !== "function") {
    return { files: [], symbols: [], decisions: [], tasks: [], ranking: {}, results: [] };
  }
  try {
    const result = engine.queryProjectGraph({
      repositoryRoot: root,
      query,
      profile: profile || "reviewer",
      taskId,
      limit,
    });
    const rows = Array.isArray(result?.results) ? result.results : [];
    return {
      files: rows.filter((row) => row.file).map((row) => ({ repository: row.repository || null, path: row.file })),
      symbols: [...new Set(rows.map((row) => row.symbol).filter(Boolean))],
      decisions: [...new Set(rows.filter((row) => row.node_type === "decision").map((row) => row.symbol || row.node_id || ""))],
      tasks: [...new Set(rows.filter((row) => row.node_type === "task").map((row) => row.symbol || row.node_id || ""))],
      ranking: {
        meanScore:
          rows.length
            ? rows.reduce((acc, row) => acc + Number(row.score || 0), 0) / rows.length
            : 0,
      },
      results: rows,
    };
  } catch {
    return { files: [], symbols: [], decisions: [], tasks: [], ranking: {}, results: [] };
  }
}

function gatherRelatedFindings(root, taskId, repository, options = {}) {
  const payload = readJson(path.join(root, "analysis-results", "findings.json"));
  if (!payload || !Array.isArray(payload.findings)) return [];
  const normalizedTask = String(taskId || "").toUpperCase();
  return payload.findings
    .filter((finding) => {
      if (repository && String(finding.repository || "") !== String(repository)) return false;
      if (normalizedTask && String(finding.taskId || finding.task || "").toUpperCase() === normalizedTask) return true;
      return !normalizedTask && !repository;
    })
    .map((finding) => finding.id || `${finding.rule || "finding"}:${finding.file || ""}:${finding.line || 0}`);
}

function buildEvaluationReadiness(root, prNumber, repository, profile) {
  const evaluation = loadEvaluationEngine();
  if (!evaluation?.validateAgentRegression) {
    const staticEngine = loadStaticAnalysis();
    if (!staticEngine?.validateMergeReadiness) return null;
    try {
      return staticEngine.validateMergeReadiness({
        findingFile: path.join(root, "analysis-results", "findings.json"),
        repositoryRoot: root,
        profile: profile || "coder",
        pr: prNumber,
      });
    } catch {
      return null;
    }
  }
  const baseline = path.join(root, "evaluations", "baselines", `${normalizeProfile(profile)}.json`);
  const current = path.join(root, "evaluations", "results.json");
  if (!fs.existsSync(current) || !evaluation.validateAgentRegression) return null;
  try {
    return evaluation.validateAgentRegression({
      current,
      baseline,
    });
  } catch {
    return null;
  }
}

function recordAgentRun(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const taskId = String(options.taskId || "").toUpperCase();
  const context = collectTaskAndRepoEvidence(repositoryRoot);
  const relatedFindings = Array.isArray(options.relatedFindings)
    ? options.relatedFindings
    : gatherRelatedFindings(repositoryRoot, taskId, options.repository, options);
  const trace = makeTrace({
    ...options,
    repositoryRoot,
    operation: "record-agent-run",
    inputSummary: options.inputSummary || `agent run requested`,
    outputSummary: options.outputSummary || "agent run completed",
    relatedFindings,
  });
  trace.metadata.linked_context = options.contextPackage || null;
  trace.metadata.linked_prompt = options.promptId || "default";
  trace.metadata.decision_ids = context.tasks;
  trace.metadata.dependencies = context.dependencies;
  return writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
}

function recordContextPackage(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const contextPath = options.contextPath || options.contextPackage || path.join(repositoryRoot, "generated-context");
  const profile = options.profile || "coder";
  const included = listFiles(contextPath);
  const excludedInput = parseJsonList(options.excluded || options.excludedFiles);
  const excluded = excludedInput.length ? excludedInput : [];
  const rep = collectMetadataFromRepo(repositoryRoot);

  const trace = makeTrace({
    ...options,
    repositoryRoot,
    operation: "record-context-package",
    contextPackage: toPosix(contextPath),
    profile,
    inputSummary: `profile=${profile} files=${included.length}`,
    outputSummary: `context package generated at ${contextPath}`,
  });

  trace.metadata = {
    ...trace.metadata,
    profile,
    files_included: included,
    files_excluded: excluded,
    related_repositories: rep.repositories,
    related_tasks: gatherTaskIdsFromContext(contextPath, repositoryRoot),
    related_dependencies: rep.dependencies,
    estimated_tokens: rep.estimated_tokens,
  };
  return writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
}

function recordRetrievalRun(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const query = String(options.query || "");
  const profile = options.profile || "reviewer";
  const taskId = options.taskId || null;
  const limit = Number(options.limit || 25);

  const provided = options.results ? parseJsonList(options.results) : null;
  const repoIntel = provided
    ? { files: provided, symbols: [], decisions: [], tasks: [], ranking: {} }
    : gatherRepoIntelligenceOutput(repositoryRoot, query, profile, taskId, limit);
  const graphRows = gatherGraphOutput(repositoryRoot, query, profile, taskId, limit);

  const files = new Map();
  for (const row of [...(repoIntel.files || []), ...(graphRows.files || [])]) {
    const value = typeof row === "string" ? row : row.path || row.file;
    if (value) files.set(value, row);
  }

  const trace = makeTrace({
    ...options,
    repositoryRoot,
    operation: "record-retrieval-run",
    inputSummary: `query=${query}`,
    outputSummary: `files=${files.size} symbols=${(repoIntel.symbols || []).length + (graphRows.symbols || []).length}`,
  });
  trace.metadata = {
    ...trace.metadata,
    query,
    profile,
    repository_filter: options.repository,
    files_included: [...files.values()],
    symbols: [...new Set([...(repoIntel.symbols || []), ...(graphRows.symbols || [])])],
    decisions: [...new Set([...(repoIntel.decisions || []), ...(graphRows.decisions || [])])],
    tasks: [...new Set([...(repoIntel.tasks || []), ...(graphRows.tasks || [])])],
    ranking: {
      repoIntelligence: repoIntel.ranking,
      graph: graphRows.ranking,
    },
  };
  trace.related_findings = [...new Set([
    ...(trace.related_findings || []),
    ...(graphRows.results || []).map((row) => (row.node_type === "finding" ? row.node_id : null)).filter(Boolean),
  ])];
  return writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
}

function recordReviewLoop(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const taskId = String(options.taskId || "").toUpperCase();
  const iterations = Number(options.iterations || 1);
  const beforeFindings = readFindingSet(path.resolve(options.beforeFindings || path.join(repositoryRoot, "analysis-results", "before-findings.json")));
  const afterFindings = readFindingSet(path.resolve(options.afterFindings || path.join(repositoryRoot, "analysis-results", "findings.json")));
  const diff = diffFindingLists(beforeFindings, afterFindings);
  const readiness = buildEvaluationReadiness(repositoryRoot, options.pr, options.repository, options.profile || "coder");

  const trace = makeTrace({
    ...options,
    repositoryRoot,
    operation: "record-review-loop",
    taskId,
    inputSummary: `iterations=${iterations}`,
    outputSummary: `introduced=${diff.introduced.length} resolved=${diff.resolved.length} severityIncreases=${diff.severityIncreases.length}`,
    relatedFindings: [...diff.introduced, ...diff.resolved, ...diff.severityIncreases].map(
      (row) => row.findingId || row.id || row.rule || row.file || "finding",
    ),
  });

  trace.metadata = {
    ...trace.metadata,
    task_id: taskId,
    iterations,
    findings_before: beforeFindings,
    findings_after: afterFindings,
    findings_introduced: diff.introduced,
    findings_resolved: diff.resolved,
    findings_severity_increases: diff.severityIncreases,
    blocking_findings: readiness?.blocking_findings || [],
    final_readiness: readiness || { merge_ready: true },
    review_files: Array.isArray(options.reviewFiles) ? options.reviewFiles : [],
    pr_number: options.pr || null,
  };
  return writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
}

function recordEvaluationRun(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const evaluationPath = path.resolve(
    options.evaluationPath || options.evaluationFile || path.join(repositoryRoot, "evaluations", "results.json"),
  );
  const payload = readJson(evaluationPath);
  const evaluations = Array.isArray(payload?.evaluations)
    ? payload.evaluations
    : Array.isArray(payload)
      ? payload
      : [];
  const evals = [];
  const relatedTasks = new Set();

  for (const row of evaluations) {
    const task = String(row.task_id || "");
    if (options.taskId && task && task.toUpperCase() === String(options.taskId).toUpperCase()) {
      evals.push({
        id: row.evaluation_id || row.id || row.suite,
        score: Number(row.score || 0),
        pass: Boolean(row.pass),
        suite: row.suite || "unknown",
      });
      if (task) relatedTasks.add(task.toUpperCase());
      continue;
    }
    if (!options.taskId) {
      evals.push({
        id: row.evaluation_id || row.id || row.suite,
        score: Number(row.score || 0),
        pass: Boolean(row.pass),
        suite: row.suite || "unknown",
      });
      if (task) relatedTasks.add(task.toUpperCase());
    }
  }

  const score = evals.length ? evals.reduce((sum, row) => sum + Number(row.score || 0), 0) / evals.length : 0;
  const trace = makeTrace({
    ...options,
    repositoryRoot,
    operation: "record-evaluation-run",
    taskId: options.taskId || Array.from(relatedTasks)[0] || "",
    inputSummary: `suite=${options.suite || "evaluation"}`,
    outputSummary: `evaluations=${evals.length} avgScore=${score}`,
    relatedEvaluations: evals.map((row) => row.id),
  });
  trace.metadata = {
    ...trace.metadata,
    provider: options.provider || "evaluation",
    suite: options.suite || "evaluation",
    profile: options.profile || trace.metadata?.profile || "coder",
    evaluations: evals,
    pass: evals.every((row) => row.pass),
    average_score: score,
    related_tasks: [...relatedTasks],
  };
  return writeTrace(trace, { repositoryRoot, observabilityRoot: options.observabilityRoot });
}

function loadTracePathFromArg(repositoryRoot, value) {
  const candidate = path.resolve(repositoryRoot, value);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const tracesDir = path.join(repositoryRoot, "observability", "traces");
  return path.join(tracesDir, `${value}.json`);
}

function collectEvaluationScores(repositoryRoot, ids = []) {
  const data = readJson(path.join(repositoryRoot, "evaluations", "results.json"));
  const rows = Array.isArray(data?.evaluations) ? data.evaluations : [];
  if (ids.length === 0) {
    if (rows.length === 0) return 0;
    return rows.reduce((acc, row) => acc + Number(row.score || 0), 0) / rows.length;
  }
  const selected = rows.filter((row) => ids.includes(row.evaluation_id || row.id || row.suite));
  if (selected.length === 0) return 0;
  return selected.reduce((acc, row) => acc + Number(row.score || 0), 0) / selected.length;
}

function compareAgentRuns(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const baselinePath = loadTracePathFromArg(repositoryRoot, options.baseline || options._positional0);
  const currentPath = loadTracePathFromArg(repositoryRoot, options.current || options._positional1);
  const baseline = readJson(baselinePath);
  const current = readJson(currentPath);
  if (!baseline || !current) {
    throw new Error("compare-agent-runs requires baseline and current trace paths or ids");
  }
  const baselineEval = baseline.related_evaluations || [];
  const currentEval = current.related_evaluations || [];
  const baselineAvg = collectEvaluationScores(repositoryRoot, baselineEval);
  const currentAvg = collectEvaluationScores(repositoryRoot, currentEval);
  const output = {
    baseline_id: baseline.trace_id || "",
    current_id: current.trace_id || "",
    prompt_changes: {
      baseline: `${baseline.prompt_id || "default"}@${baseline.prompt_version || ""}`,
      current: `${current.prompt_id || "default"}@${current.prompt_version || ""}`,
      changed: baseline.prompt_id !== current.prompt_id || baseline.prompt_version !== current.prompt_version,
    },
    context_changes: {
      baseline: baseline.context_package || null,
      current: current.context_package || null,
      changed: baseline.context_package !== current.context_package,
    },
    retrieval_changes: {
      baselineFiles: baseline.metadata?.files_included || [],
      currentFiles: current.metadata?.files_included || [],
      changed: JSON.stringify(baseline.metadata?.files_included || []) !== JSON.stringify(current.metadata?.files_included || []),
    },
    output_changes: {
      baseline_output: baseline.output_summary || "",
      current_output: current.output_summary || "",
      changed: baseline.output_summary !== current.output_summary,
    },
    evaluation_diff: {
      baselineAvg,
      currentAvg,
      delta: currentAvg - baselineAvg,
      baseline: baselineEval,
      current: currentEval,
    },
  };
  const outputFile = options.outputFile || path.join(repositoryRoot, "observability", "trace-compare.json");
  writeJson(outputFile, output);
  return output;
}

function validateTraceState(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const observabilityRoot = path.resolve(options.observabilityRoot || path.join(repositoryRoot, "observability"));
  const outputPath = options.outputFile || path.join(observabilityRoot, "validation", "trace-state.json");
  const indexPath = path.join(observabilityRoot, TRACE_INDEX_FILE);
  const index = readJson(indexPath) || { traces: [] };
  const traces = loadExistingTraces(repositoryRoot);
  const failures = [];
  if (traces.length === 0) {
    failures.push("no traces exist");
  }
  for (const entry of index.traces || []) {
    const tracePath = path.join(observabilityRoot, "traces", `${entry.trace_id}.json`);
    const trace = readJson(tracePath);
    if (!trace) {
      failures.push(`missing trace file ${entry.trace_id}`);
      continue;
    }
    const validation = validateTrace(trace);
    if (!validation.valid) {
      failures.push(`${entry.trace_id}:${validation.missing.join(",")}`);
      continue;
    }
    if (!trace.context_package && trace.operation === "record-context-package") {
      failures.push(`missing context_package for trace ${trace.trace_id}`);
    }
  }
  const payload = {
    valid: failures.length === 0,
    generated_at: now(),
    total_traces: traces.length,
    indexed_traces: (index.traces || []).length,
    failures,
  };
  writeJson(outputPath, payload);
  return payload;
}

function exportTraceSummary(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const observabilityRoot = path.resolve(options.observabilityRoot || path.join(repositoryRoot, "observability"));
  const summaryPath = options.outputFile || path.join(observabilityRoot, "summaries", "trace-summary.md");
  const traces = loadExistingTraces(repositoryRoot);
  traces.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  const recent = traces.slice(0, Number(options.limit || 50));
  const byTask = {};
  const byPrompt = {};
  const byRole = {};
  let contextPackages = 0;
  let reviewLoops = 0;
  let evaluationLinks = 0;

  for (const trace of recent) {
    byTask[trace.task_id || "(none)"] = (byTask[trace.task_id || "(none)"] || 0) + 1;
    byPrompt[trace.prompt_id || "default"] = (byPrompt[trace.prompt_id || "default"] || 0) + 1;
    byRole[trace.agent_role || "unknown"] = (byRole[trace.agent_role || "unknown"] || 0) + 1;
    if (trace.operation === "record-context-package") contextPackages += 1;
    if (trace.operation === "record-review-loop") reviewLoops += 1;
    if ((trace.related_evaluations || []).length > 0) evaluationLinks += 1;
  }

  const lines = [];
  lines.push("# Trace Summary");
  lines.push(`Generated: ${now()}`);
  lines.push(`Total traces: ${traces.length}`);
  lines.push("");
  lines.push("## Recent agent runs");
  for (const trace of recent) {
    lines.push(`- ${trace.timestamp} ${trace.operation} ${trace.agent_role} task=${trace.task_id || "n/a"}`);
  }
  lines.push("");
  lines.push("## Prompt versions");
  for (const [prompt, count] of Object.entries(byPrompt)) lines.push(`- ${prompt}: ${count}`);
  lines.push("## Task activity");
  for (const [task, count] of Object.entries(byTask)) lines.push(`- ${task}: ${count}`);
  lines.push("## Role activity");
  for (const [role, count] of Object.entries(byRole)) lines.push(`- ${role}: ${count}`);
  lines.push("");
  lines.push(`- context packages: ${contextPackages}`);
  lines.push(`- review loops: ${reviewLoops}`);
  lines.push(`- evaluation links: ${evaluationLinks}`);

  writeText(summaryPath, `${lines.join("\n")}\n`);
  return {
    output_path: summaryPath,
    total_traces: traces.length,
    recent_traces: recent.length,
    by_prompt: byPrompt,
    by_task: byTask,
    by_role: byRole,
  };
}

function loadExistingTraces(repositoryRoot) {
  const tracesDir = path.resolve(repositoryRoot, "observability", "traces");
  if (!fs.existsSync(tracesDir)) return [];
  const files = fs.readdirSync(tracesDir).filter((name) => /\.json$/i.test(name));
  const traces = [];
  for (const file of files) {
    const parsed = readJson(path.join(tracesDir, file));
    if (parsed) traces.push(parsed);
  }
  traces.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return traces;
}

function exportLangfuseData(options = {}) {
  const provider = loadProvider("langfuse");
  if (!provider || typeof provider.exportTraces !== "function") {
    return { path: null, count: 0, reason: "provider unavailable" };
  }
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const traces = loadExistingTraces(repositoryRoot);
  const outputFile = options.outputFile || path.join(repositoryRoot, "observability", "langfuse-export.json");
  return provider.exportTraces({
    traces,
    outputPath: outputFile,
    repositoryRoot,
    sendRemote: false,
    ...loadConfig(options.configPath)?.providers?.langfuse,
  });
}

module.exports = {
  loadConfig,
  loadPromptRegistry,
  findPromptEntry,
  loadProvider,
  readTrace,
  readTraceIndex,
  updateTraceIndex,
  loadExistingTraces,
  redactValue,
  redactObject,
  recordTrace,
  recordAgentRun,
  recordContextPackage,
  recordRetrievalRun,
  recordReviewLoop,
  recordEvaluationRun,
  exportTraceSummary,
  compareAgentRuns,
  validateTraceState,
  validateTrace,
  exportLangfuseData,
  validateTraceFileCompatibility: validateTrace,
};
