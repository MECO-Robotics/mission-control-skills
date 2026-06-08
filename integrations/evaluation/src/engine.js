const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "evaluation-config.json");
const DEFAULT_RESULT_FILE = "results.json";
const DEFAULT_RESULTS_FILE_ENV = "MC_EVAL_RESULT_FILE";
const DEFAULT_SCORECARD_FILE = "scorecard.md";
const DEFAULT_DELTA_FILE = "evaluation-delta.md";
const DEFAULT_TASK_EVAL_FILE = "task-context-eval.md";
const DEFAULT_REVIEW_EVAL_FILE = "review-quality.md";
const DEFAULT_SUMMARY_FILE = "evaluation-summary.md";

const PROFILE_SUITES = ["architect", "coder", "reviewer", "maintainer", "retrieval", "workflow", "ci"];
const ALL_SUITES = new Set(PROFILE_SUITES);

function now() {
  return new Date().toISOString();
}

function clamp01(value) {
  const v = Number(value) || 0;
  if (v < 0 || Number.isNaN(v)) return 0;
  if (v > 1) return 1;
  return v;
}

function toPosix(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function normalizeSuiteName(value) {
  return String(value || "").toLowerCase().trim();
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  return childProcess.spawnSync(checker, [command], { encoding: "utf8" }).status === 0;
}

function parseArgs(argv = []) {
  const out = {};
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--suite") {
      out.suite = args[i + 1];
      i += 1;
    } else if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
    } else if (arg === "--provider") {
      out.provider = args[i + 1];
      i += 1;
    } else if (arg === "--result-dir") {
      out.resultDir = args[i + 1];
      i += 1;
    } else if (arg === "--config") {
      out.configPath = args[i + 1];
      i += 1;
    } else if (arg === "--previous") {
      out.previous = args[i + 1];
      i += 1;
    } else if (arg === "--current") {
      out.current = args[i + 1];
      i += 1;
    } else if (arg === "--baseline") {
      out.baseline = args[i + 1];
      i += 1;
    } else if (arg === "--task") {
      out.taskId = args[i + 1];
      i += 1;
    } else if (arg === "--review-file") {
      out.reviewFile = args[i + 1];
      i += 1;
    } else if (arg === "--result-file") {
      out.resultFile = args[i + 1];
      i += 1;
    } else if (arg === "--baseline-file") {
      out.baselineFile = args[i + 1];
      i += 1;
    } else if (arg === "--pr") {
      out.pr = args[i + 1];
      i += 1;
    } else if (arg === "--repository-root" || arg === "--repo-root") {
      out.repositoryRoot = args[i + 1];
      i += 1;
    } else if (arg === "--output-file") {
      out.outputFile = args[i + 1];
      i += 1;
    } else if (!out._positional0) {
      out._positional0 = arg;
    } else if (!out._positional1) {
      out._positional1 = arg;
    }
  }
  return out;
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const cfg = readJson(configPath);
  if (!cfg) {
    throw new Error(`Evaluation config missing: ${configPath}`);
  }
  const defaults = cfg.defaults || {};
  return {
    profiles: cfg.profiles || {},
    providers: cfg.providers || {},
    integration: cfg.integration || {},
    defaults: {
      provider: defaults.provider || "promptfoo",
      resultDir: defaults.result_dir || "evaluations",
      resultFile: defaults.result_file || DEFAULT_RESULT_FILE,
      summaryFile: defaults.summary_file || DEFAULT_SCORECARD_FILE,
      profile: defaults.profile || "coder",
      pass_threshold: defaults.pass_threshold || 70,
      max_score: defaults.max_score || 100,
      repository_root: defaults.repository_root || ".",
      regression: {
        max_drop_points: (defaults?.regression?.max_drop_points ?? 10),
        max_drop_percent: (defaults?.regression?.max_drop_percent ?? 12),
      },
    },
    resultFileFallback: DEFAULT_RESULT_FILE,
    scorecardFileFallback: DEFAULT_SCORECARD_FILE,
    deltaFile: DEFAULT_DELTA_FILE,
  };
}

function loadSuite(suite) {
  const suiteName = normalizeSuiteName(suite || "architect");
  const suitePath = path.join(__dirname, "..", "suites", suiteName, "cases.json");
  const payload = readJson(suitePath);
  if (!payload || !Array.isArray(payload.cases)) {
    throw new Error(`Suite missing or invalid: ${suitePath}`);
  }
  return {
    name: suiteName,
    cases: payload.cases,
    defaults: payload.defaults || {},
  };
}

function resolveProfile(profiles, suiteName) {
  return profiles?.[normalizeSuiteName(suiteName)] || profiles?.coder || profiles?.[0] || {
    name: suiteName,
    max_score: 100,
    pass_threshold: 70,
    weights: {},
  };
}

function loadProvider(name) {
  const provider = normalizeSuiteName(name || "promptfoo");
  if (provider === "promptfoo" || provider === "noop" || provider === "null") {
    try {
      return require(path.join(__dirname, "..", "providers", "promptfoo", "index.js"));
    } catch {
      return null;
    }
  }
  return null;
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

function detectTasksFromCases(cases = []) {
  const taskIds = new Set();
  for (const row of cases) {
    const query = String(row?.query || "");
    const matches = query.match(/\bMC-\d+\b/gi);
    if (matches) {
      for (const match of matches) taskIds.add(match.toUpperCase());
    }
  }
  return [...taskIds];
}

function loadDependencies(root) {
  const payload = readJson(path.join(root, "dependency-map.json"));
  if (!payload || !Array.isArray(payload.dependencies)) return [];
  return payload.dependencies
    .map((row) => ({
      from: String(row.from || "").toUpperCase(),
      to: String(row.to || "").toUpperCase(),
      type: row.type || "depends_on",
      repository: row.repository || row.repo || null,
      taskId: row.taskId || row.task || null,
      file: row.file || null,
      metadata: row.metadata || null,
    }))
    .filter((row) => row.from && row.to);
}

function loadGlobalIssues(root) {
  const payload = readJson(path.join(root, "global-issues.json"));
  const list = Array.isArray(payload?.tasks) ? payload.tasks : [];
  return list
    .map((row) => ({
      id: String(row?.id || "").toUpperCase(),
      repository: row.repository || row.repo || null,
      title: row.title || "",
      files: Array.isArray(row.files) ? row.files : [],
      decisions: Array.isArray(row.decisions) ? row.decisions : [],
      dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      state: row.state || "open",
    }))
    .filter((row) => row.id);
}

function loadRepoRegistry(root) {
  const payload = readJson(path.join(root, "repo-registry.json")) || {};
  const repos = payload.repositories || {};
  if (Array.isArray(repos)) return repos;
  return Object.entries(repos).map(([id, row]) => ({
    id,
    path: row?.path || id,
    owner: row?.owner || null,
  }));
}

function loadTokenReport(root) {
  const candidates = [
    path.join(root, "generated-context", "token-report.json"),
    path.join(root, "generated-context", "repo-summary.json"),
  ];
  for (const candidate of candidates) {
    const payload = readJson(candidate);
    if (payload && typeof payload === "object" && Number.isFinite(Number(payload.estimated_tokens))) {
      return payload;
    }
  }
  return null;
}

function collectArtifacts(root, suiteCases = []) {
  const taskIds = detectTasksFromCases(suiteCases);
  const tokenReport = loadTokenReport(root);
  const depRows = loadDependencies(root);
  const tasks = loadGlobalIssues(root);
  const files = {
    "generated-context/task-context.xml": fileExists(path.join(root, "generated-context", "task-context.xml")),
    "generated-context/task-summary.md": fileExists(path.join(root, "generated-context", "task-summary.md")),
    "generated-context/task-dependencies.md": fileExists(path.join(root, "generated-context", "task-dependencies.md")),
    "generated-context/repo-context.xml": fileExists(path.join(root, "generated-context", "repo-context.xml")),
    "generated-context/repo-summary.md": fileExists(path.join(root, "generated-context", "repo-summary.md")),
    "generated-context/pr-context.xml": fileExists(path.join(root, "generated-context", "pr-context.xml")),
    "generated-context/graph-context.md": fileExists(path.join(root, "generated-context", "graph-context.md")),
    "generated-context/related-decisions.md": fileExists(path.join(root, "generated-context", "related-decisions.md")),
    "generated-context/affected-repositories.md": fileExists(path.join(root, "generated-context", "affected-repositories.md")),
    "generated-context/diff-summary.md": fileExists(path.join(root, "generated-context", "diff-summary.md")),
    "analysis-results/findings.json": fileExists(path.join(root, "analysis-results", "findings.json")),
    "analysis-results/review-findings.md": fileExists(path.join(root, "analysis-results", "review-findings.md")),
    "analysis-results/summary.json": fileExists(path.join(root, "analysis-results", "summary.json")),
    "release-notes.md": fileExists(path.join(root, "release-notes.md")),
    "global-issues.json": fileExists(path.join(root, "global-issues.json")),
    "dependency-map.json": fileExists(path.join(root, "dependency-map.json")),
    "repo-registry.json": fileExists(path.join(root, "repo-registry.json")),
    "git-wiki.json": fileExists(path.join(root, "git-wiki.json")),
    "git-nexus.json": fileExists(path.join(root, "git-nexus.json")),
    "architecture-wiki.md": fileExists(path.join(root, "architecture-wiki.md")),
    "decision-log.json": fileExists(path.join(root, "decision-log.json")),
    "evaluations/results.json": fileExists(path.join(root, "evaluations", "results.json")),
  };

  let analysisFindings = [];
  const findingPayload = readJson(path.join(root, "analysis-results", "findings.json"));
  if (findingPayload && Array.isArray(findingPayload.findings)) {
    analysisFindings = findingPayload.findings;
  }

  const graphify = loadGraphify();
  const repoIntelligence = loadRepositoryIntelligence();

  const repoSummary = loadRepoRegistry(root);
  const repositoryCount = new Set((repoSummary || []).map((row) => row.id)).size;
  const taskCount = tasks.filter((row) => taskIds.includes(row.id)).length;

  return {
    root,
    taskIds,
    files,
    tasks,
    dependencies: depRows,
    repositoryCount,
    foundTasks: taskCount,
    registry: repoSummary,
    analysisFindings,
    graphify,
    repoIntelligence,
    tokenReport,
    estimatedTokens: Number(tokenReport?.estimated_tokens || 0),
    requiredArtifacts: Object.entries(files).filter((row) => row[1]).map((row) => row[0]),
    architectureDocuments: {
      hasDecisionLog: fileExists(path.join(root, "decision-log.json")),
      hasArchitectureWiki: fileExists(path.join(root, "architecture-wiki.md")),
      hasGitWiki: fileExists(path.join(root, "git-wiki.json")),
      hasReleaseNotes: fileExists(path.join(root, "release-notes.md")),
    },
    testEvidence: {
      hasTasks: taskIds.length > 0,
      taskFiles: taskIds.length,
      issueFileExists: fileExists(path.join(root, "global-issues.json")),
      dependencyMapExists: fileExists(path.join(root, "dependency-map.json")),
    },
  };
}

function repositoryIntelligenceSearch(engine, query, profile, repositoryRoot, limit = 10) {
  if (!engine || typeof engine.hybridSearch !== "function") return [];
  try {
    return engine.hybridSearch({
      repositoryRoot,
      query,
      profile,
      limit,
    })?.results || [];
  } catch {
    return [];
  }
}

function graphifySearch(engine, query, profile, repositoryRoot, limit = 10) {
  if (!engine || typeof engine.queryProjectGraph !== "function") return [];
  try {
    return engine.queryProjectGraph({
      repositoryRoot,
      query,
      profile,
      limit,
    })?.results || [];
  } catch {
    return [];
  }
}

function readArtifact(filePath) {
  return readText(filePath);
}

function evaluateArchitect(context) {
  const total = Math.max(context.taskIds.length, 1);
  const taskMatch = context.taskIds.filter((taskId) =>
    context.tasks.some((row) => row.id === taskId),
  ).length;
  const dependencyMatches = context.dependencies.filter((row) =>
    context.taskIds.includes(row.from) || context.taskIds.includes(row.to),
  ).length;
  const artifactBoost = (context.files["generated-context/task-context.xml"] ? 1 : 0)
    + (context.files["dependency-map.json"] ? 0.35 : 0)
    + (context.architectureDocuments.hasArchitectureWiki ? 0.15 : 0)
    + (context.architectureDocuments.hasDecisionLog ? 0.1 : 0);
  const repoBoost = context.repositoryCount > 0
    ? Math.min(1, context.repositoryCount / Math.max(1, context.tasks.length || 1))
    : 0.25;
  const metrics = {
    decomposition_quality: clamp01(0.35 + 0.65 * (taskMatch / total)),
    dependency_identification: clamp01(0.2 + Math.min(0.8, dependencyMatches / Math.max(1, total * 2))),
    repository_ownership_accuracy: clamp01(Math.min(0.9, repoBoost)),
    task_planning_quality: clamp01(Math.min(1, 0.45 + artifactBoost)),
  };
  return {
    metrics,
    notes: [
      `Architect evaluation included ${taskMatch}/${total} task artifacts`,
      `Dependency match count: ${dependencyMatches}`,
      `Repository registry entries: ${context.repositoryCount}`,
    ],
  };
}

function evaluateCoder(context) {
  const query = context.taskIds[0] || "implementation planning";
  const engine = context.repoIntelligence;
  const hits = repositoryIntelligenceSearch(engine, query, "coder", context.root, 12).length;
  const testHits = repositoryIntelligenceSearch(context.repoIntelligence, "test", "coder", context.root, 8);
  const hasRelevantTests = testHits.some((row) => (String(row.file || "").toLowerCase().includes("test") || String(row.type || "").toLowerCase() === "test"));
  const docsAvailable = context.architectureDocuments.hasGitWiki || context.architectureDocuments.hasArchitectureWiki;
  const metrics = {
    implementation_correctness: clamp01(0.4 + Math.min(0.6, hits / 12)),
    test_coverage_impact: clamp01(hasRelevantTests ? 0.78 : 0.45),
    issue_completion: clamp01(context.taskIds.length ? context.foundTasks / context.taskIds.length : 0.6),
    architecture_adherence: clamp01(docsAvailable ? 0.8 : 0.45),
  };
  return {
    metrics,
    notes: [
      `Repo Intelligence hits: ${hits}`,
      `Test hints found: ${testHits.length}`,
    ],
  };
}

function evaluateReviewer(context, reviewFile = null) {
  const findings = Array.isArray(context.analysisFindings) ? context.analysisFindings : [];
  const reviewText = readArtifact(reviewFile || path.join(context.root, "analysis-results", "review-findings.md")) || "";
  const byRule = new Set(findings.map((row) => row.rule).filter(Boolean));
  const matched = [...byRule].filter((rule) => reviewText.includes(rule)).length;
  const bySeverity = {};
  for (const finding of findings) {
    const severity = String(finding.severity || "info").toLowerCase();
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }
  const findingCount = findings.length || 1;
  const quality = clamp01((matched / findingCount) * 0.7 + Math.min(0.3, context.files["analysis-results/review-findings.md"] ? 0.3 : 0));
  const falsePositiveRate = byRule.size ? clamp01(1 - Math.min(1, matched / byRule.size)) : 0;
  const metrics = {
    finding_quality: quality,
    false_positive_rate: clamp01(1 - falsePositiveRate),
    severity_accuracy: clamp01(0.5 + 0.1 * Number(Boolean(context.files["analysis-results/findings.json"])) + (bySeverity.critical ? 0.2 : 0)),
    missed_issue_rate: clamp01(1 - quality),
  };
  return {
    metrics,
    notes: [
      `Review findings file present: ${context.files["analysis-results/review-findings.md"]}`,
      `Matched by rule: ${matched}/${byRule.size}`,
    ],
  };
}

function evaluateMaintainer(context) {
  const critical = context.analysisFindings.filter((row) => String(row.severity).toLowerCase() === "critical").length;
  const high = context.analysisFindings.filter((row) => String(row.severity).toLowerCase() === "high").length;
  const totalFindings = context.analysisFindings.length || 1;
  const repoHealthScore = clamp01(1 - Math.min(0.8, (critical * 0.25) + (high * 0.08)));
  const metrics = {
    merge_readiness: clamp01(1 - ((critical * 0.06) + (high * 0.01))),
    dependency_awareness: clamp01(context.dependencies.length / Math.max(1, context.taskIds.length || 1) / 2),
    release_readiness: clamp01(context.architectureDocuments.hasReleaseNotes ? 0.9 : 0.45),
    repository_health: repoHealthScore,
  };
  return {
    metrics,
    notes: [
      `Critical findings: ${critical}`,
      `High findings: ${high}`,
      `Total findings: ${totalFindings}`,
    ],
  };
}

function evaluateRetrieval(context) {
  const query = context.taskIds[0] || "architecture";
  const graphRows = graphifySearch(context.graphify, query, "reviewer", context.root, 12);
  const searchRows = repositoryIntelligenceSearch(context.repoIntelligence, query, "retrieval", context.root, 12);
  const hasArchitectureEvidence = context.architectureDocuments.hasArchitectureWiki || context.architectureDocuments.hasDecisionLog || context.architectureDocuments.hasGitWiki;
  const metrics = {
    context_relevance: clamp01(Math.min(1, Math.max(searchRows.length / 10, hasArchitectureEvidence ? 0.5 : 0))),
    missing_context_penalty: clamp01(1 - Math.min(1, (searchRows.length) / 12)),
    ranking_quality: clamp01(Math.min(1, graphRows.length / 8 + (searchRows.length > 0 ? 0.3 : 0))),
    architecture_awareness: clamp01(hasArchitectureEvidence ? 0.9 : 0.3),
  };
  return {
    metrics,
    notes: [
      `Hybrid candidates: ${searchRows.length}`,
      `Graph candidates: ${graphRows.length}`,
      `Architecture evidence: ${hasArchitectureEvidence}`,
    ],
  };
}

function evaluateWorkflow(context) {
  const hasTask = context.files["generated-context/task-context.xml"] || context.files["generated-context/task-summary.md"];
  const hasPr = context.files["generated-context/pr-context.xml"] || context.files["generated-context/diff-summary.md"];
  const hasTaskIds = context.taskIds.length > 0;
  const artifacts = context.taskIds.length || 1;
  const metrics = {
    issue_to_pr_traceability: clamp01((hasTask && hasPr ? 0.9 : 0.4) * (hasTaskIds ? 1 : 0.5)),
    handoff_quality: clamp01((context.files["generated-context/task-summary.md"] ? 0.6 : 0.2) + (context.files["generated-context/diff-summary.md"] ? 0.3 : 0)),
    review_artifact_presence: clamp01(context.files["analysis-results/review-findings.md"] ? 0.85 : 0.4),
    repository_context_presence: clamp01(context.files["generated-context/repo-context.xml"] ? 0.85 : 0.3),
  };
  const scoreScale = artifacts > 0 ? artifacts : 1;
  return {
    metrics: {
      issue_to_pr_traceability: clamp01(metrics.issue_to_pr_traceability * Math.min(1, Math.max(0.3, context.foundTasks / scoreScale))),
      handoff_quality: metrics.handoff_quality,
      review_artifact_presence: metrics.review_artifact_presence,
      repository_context_presence: metrics.repository_context_presence,
    },
    notes: [
      `Task-context exists: ${Boolean(context.files["generated-context/task-context.xml"])}`,
      `PR context exists: ${Boolean(context.files["generated-context/pr-context.xml"])}`,
      `Review findings exists: ${Boolean(context.files["analysis-results/review-findings.md"])}`,
    ],
  };
}

function scoreFromProfile(metrics, profileCfg) {
  const normalized = {};
  const weights = profileCfg.weights || {};
  let weighted = 0;
  let weightSum = 0;
  for (const [key, raw] of Object.entries(metrics)) {
    const value = clamp01(raw);
    normalized[key] = value;
    const weight = Number(weights[key] || 1);
    weighted += value * weight;
    weightSum += Math.max(0, weight);
  }
  if (weightSum === 0) {
    const keys = Object.keys(normalized);
    const avg = keys.length === 0 ? 0 : keys.reduce((acc, key) => acc + normalized[key], 0) / keys.length;
    return { score: avg, weighted: avg, categoryScores: normalized, maxScore: profileCfg.max_score || 100 };
  }
  const score = weighted / weightSum;
  return { score, weighted, categoryScores: normalized, maxScore: profileCfg.max_score || 100 };
}

function inferMetricScoreFromCase(name, query, metricTargets = {}) {
  const normalizedName = normalizeSuiteName(name);
  const normalizedQuery = normalizeSuiteName(query);
  if (metricTargets[normalizedName]) return metricTargets[normalizedName];
  if (normalizedName.includes("decomposition")) return "decomposition_quality";
  if (normalizedName.includes("dependency")) return "dependency_identification";
  if (normalizedName.includes("planning")) return "task_planning_quality";
  if (normalizedQuery.includes("test") || normalizedName.includes("implementation")) return "implementation_correctness";
  if (normalizedQuery.includes("missed") || normalizedName.includes("miss")) return "finding_quality";
  return null;
}

function applyProviderSignal(profileName, metrics, caseScores = {}) {
  if (!caseScores || typeof caseScores !== "object") return metrics;
  const metricTargets = {
    arch: "architecture_documents",
    review: "finding_quality",
    task: "issue_completion",
    dependency: "dependency_identification",
    graph: "repository_health",
  };
  for (const [key, value] of Object.entries(caseScores)) {
    const normalized = clamp01(value);
    if (Object.prototype.hasOwnProperty.call(metrics, key)) {
      metrics[key] = clamp01((metrics[key] + normalized) / 2);
      continue;
    }
    const metric = metricTargets[key] || inferMetricScoreFromCase(key, normalizeSuiteName(profileName), metricTargets);
    if (metric && Object.prototype.hasOwnProperty.call(metrics, metric)) {
      metrics[metric] = clamp01((metrics[metric] + normalized) / 2);
    }
  }
  return metrics;
}

function buildEvaluation(suiteName, profileName, context, providerOutput, config) {
  const profileCfg = resolveProfile(config.profiles, suiteName);
  let evalBundle = null;
  if (suiteName === "architect") evalBundle = evaluateArchitect(context);
  else if (suiteName === "coder") evalBundle = evaluateCoder(context);
  else if (suiteName === "reviewer") evalBundle = evaluateReviewer(context, providerOutput?.reviewFile);
  else if (suiteName === "maintainer") evalBundle = evaluateMaintainer(context);
  else if (suiteName === "retrieval") evalBundle = evaluateRetrieval(context);
  else if (suiteName === "workflow") evalBundle = evaluateWorkflow(context);
  else evalBundle = evaluateMaintainer(context);

  let metrics = { ...(evalBundle?.metrics || {}) };
  if (providerOutput?.caseScores) {
    metrics = applyProviderSignal(profileName, metrics, providerOutput.caseScores);
  }
  const normalized = scoreFromProfile(metrics, profileCfg);
  const score = Math.round((normalized.score * normalized.maxScore) * 100) / 100;
  const passThreshold = Number(profileCfg.pass_threshold || profileCfg.passThreshold || config.defaults.pass_threshold || 70);
  const pass = score >= passThreshold;
  const notes = [
    ...(evalBundle?.notes || []),
    providerOutput?.available === false ? `Prompt provider unavailable: ${providerOutput.reason}` : "Prompt evaluation used when available.",
  ];
  const metadata = {
    generated_at: now(),
    profile: profileName,
    repositories: [...new Set(Array.isArray(context.registry) ? context.registry.map((row) => row.id || row.path).filter(Boolean) : [])],
    tasks: [...new Set(context.taskIds)],
    dependencies: context.dependencies,
    estimated_tokens: context.estimatedTokens || 0,
    notes: [
      `Generated artifacts: ${context.requiredArtifacts.length}`,
      `Repository roots tracked: ${context.repositoryCount}`,
    ],
  };

  return {
    evaluation_id: `eval-${Date.now().toString(16)}-${Math.floor(Math.random() * 1e6).toString(16)}`,
    provider: providerOutput?.provider || "fallback",
    suite: suiteName,
    timestamp: metadata.generated_at,
    score,
    max_score: normalized.maxScore,
    pass,
    metrics: normalized.categoryScores,
    notes,
    artifacts: {
      generated_context: toPosix(path.join(context.root, "generated-context")),
      generated_graphs: toPosix(path.join(context.root, "generated-graphs")),
      evaluation_results: toPosix(path.join(context.root, config.defaults.resultDir, config.defaults.resultFile)),
    },
    dependencies: context.dependencies,
    generated_at: metadata.generated_at,
    repositories: metadata.repositories,
    tasks: metadata.tasks,
    dependency_count: metadata.dependencies.length,
    estimated_tokens: metadata.estimated_tokens,
  };
}

function runEvaluation(argv = []) {
  const args = parseArgs(argv);
  const repositoryRoot = path.resolve(args.repositoryRoot || process.cwd());
  const config = loadConfig(args.configPath);
  const suite = loadSuite(args.suite || args.profile || config.defaults.profile);
  const profile = normalizeSuiteName(args.profile || suite.name);
  const providerName = args.provider || config.defaults.provider;
  const provider = loadProvider(providerName);
  const outputDir = path.resolve(repositoryRoot, args.resultDir || config.defaults.resultDir);
  const providerInput = {
    repositoryRoot,
    suite,
    profile,
    providerConfig: config.providers?.[providerName] || {},
    outputDir,
  };
  let providerOutput = { available: false, reason: "provider unavailable" };
  if (provider && typeof provider.run === "function") {
    providerOutput = provider.run(providerInput);
  }
  const context = collectArtifacts(repositoryRoot, suite.cases);
  context.root = repositoryRoot;
  const evaluation = buildEvaluation(suite.name, profile, context, providerOutput, config);
  const resultFile = path.join(outputDir, args.resultFile || process.env[DEFAULT_RESULTS_FILE_ENV] || config.defaults.resultFile || DEFAULT_RESULT_FILE);
  const payload = {
    generated_at: now(),
    repositoryRoot,
    suite: suite.name,
    profile,
    evaluations: [evaluation],
  };
  writeJson(resultFile, payload);
  const metricsLines = Object.entries(evaluation.metrics).map((row) => `- ${row[0]}: ${row[1]}`);
  const markdown = [
    "# Evaluation Results",
    `Suite: ${evaluation.suite}`,
    `Profile: ${evaluation.profile || profile}`,
    `Provider: ${evaluation.provider}`,
    `Score: ${evaluation.score}/${evaluation.max_score}`,
    `Pass: ${evaluation.pass}`,
    `Generated at: ${evaluation.timestamp}`,
    "",
    "## Metrics",
    ...metricsLines,
    "",
    "## Notes",
    ...evaluation.notes.map((row) => `- ${row}`),
  ].join("\n");
  writeText(path.join(outputDir, "results.md"), `${markdown}\n`);
  return {
    ...evaluation,
    outputDir,
    resultPath: resultFile,
    mdPath: path.join(outputDir, "results.md"),
    repositoryRoot,
  };
}

function normalizeEvaluationPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.evaluations)) return payload.evaluations;
  if (payload.suite && typeof payload.score === "number") return [payload];
  return [];
}

function compareEvaluations(argv = []) {
  const args = parseArgs(argv);
  const previousPath = path.resolve(args.previous || args._positional0);
  const currentPath = path.resolve(args.current || args._positional1);
  const previousPayload = normalizeEvaluationPayload(readJson(previousPath));
  const currentPayload = normalizeEvaluationPayload(readJson(currentPath));
  if (previousPayload.length === 0 || currentPayload.length === 0) {
    throw new Error("Need both previous and current evaluation payloads");
  }
  const previous = previousPayload[0];
  const current = currentPayload[0];
  const prevScore = Number(previous.score || 0);
  const currScore = Number(current.score || 0);
  const scoreDelta = currScore - prevScore;
  const percentDelta = prevScore ? Number(((scoreDelta / prevScore) * 100).toFixed(3)) : 0;

  const regressions = [];
  const improvements = [];
  const keys = new Set([...Object.keys(previous.metrics || {}), ...Object.keys(current.metrics || {})]);
  for (const metric of keys) {
    const prevValue = Number(previous.metrics?.[metric] || 0);
    const currValue = Number(current.metrics?.[metric] || 0);
    const change = currValue - prevValue;
    if (change < -0.05) regressions.push({ metric, prev: prevValue, curr: currValue, delta: change });
    if (change > 0.05) improvements.push({ metric, prev: prevValue, curr: currValue, delta: change });
  }

  const outputDir = path.dirname(currentPath);
  const deltaPath = path.join(outputDir, args.outputFile || DEFAULT_DELTA_FILE);
  const markdown = [
    "# Evaluation Delta",
    `Current: ${currentPath}`,
    `Previous: ${previousPath}`,
    `Score delta: ${scoreDelta}`,
    `Percent delta: ${percentDelta}`,
    "",
    "## Regressions",
    ...(regressions.length ? regressions.map((row) => `- ${row.metric}: ${row.prev} -> ${row.curr} (${row.delta})`) : ["- none"]),
    "",
    "## Improvements",
    ...(improvements.length ? improvements.map((row) => `- ${row.metric}: ${row.prev} -> ${row.curr} (${row.delta})`) : ["- none"]),
  ].join("\n");
  writeText(deltaPath, `${markdown}\n`);

  return {
    score_delta: scoreDelta,
    percent_delta: percentDelta,
    regressions,
    improvements,
    outputPath: deltaPath,
  };
}

function generateScorecard(argv = []) {
  const args = parseArgs(argv);
  const target = path.resolve(args.resultFile || args._positional0 || path.join(process.cwd(), configPathGuess(args, DEFAULT_RESULT_FILE)));
  const payload = normalizeEvaluationPayload(readJson(target));
  if (payload.length === 0) {
    throw new Error(`No evaluations in ${target}`);
  }
  const outputDir = path.dirname(target);
  const scorecardPath = path.join(outputDir, args.outputFile || DEFAULT_SCORECARD_FILE);

  const total = payload.length;
  const passing = payload.filter((row) => row.pass).length;
  const average = payload.reduce((acc, row) => acc + Number(row.score || 0), 0) / total;
  const regressions = payload.filter((row) => !row.pass).map((row) => `${row.suite}: ${row.score}`);

  const lines = [];
  lines.push("# Evaluation Scorecard");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Overall Health: ${average.toFixed(2)}`);
  lines.push(`Passing suites: ${passing}/${total}`);
  lines.push("");
  lines.push("## Suite Summary");
  for (const row of payload) {
    lines.push(`- ${row.suite} (${row.profile}): ${row.score}/${row.max_score} ${row.pass ? "[pass]" : "[fail]"}`);
  }
  lines.push("");
  lines.push("## Architect Performance");
  for (const row of payload.filter((row) => row.suite === "architect")) {
    lines.push(`- score=${row.score}, pass=${row.pass}`);
  }
  lines.push("");
  lines.push("## Coder Performance");
  for (const row of payload.filter((row) => row.suite === "coder")) {
    lines.push(`- score=${row.score}, pass=${row.pass}`);
  }
  lines.push("");
  lines.push("## Reviewer Performance");
  for (const row of payload.filter((row) => row.suite === "reviewer")) {
    lines.push(`- score=${row.score}, pass=${row.pass}`);
  }
  lines.push("");
  lines.push("## Retrieval Performance");
  for (const row of payload.filter((row) => row.suite === "retrieval")) {
    lines.push(`- score=${row.score}, pass=${row.pass}`);
  }
  lines.push("");
  lines.push("## Workflow Performance");
  for (const row of payload.filter((row) => row.suite === "workflow")) {
    lines.push(`- score=${row.score}, pass=${row.pass}`);
  }
  lines.push("");
  lines.push("## Regression Summary");
  if (regressions.length === 0) {
    lines.push("- none");
  } else {
    for (const row of regressions) lines.push(`- ${row}`);
  }

  writeText(scorecardPath, `${lines.join("\n")}\n`);
  return {
    outputPath: scorecardPath,
    suites: payload.length,
    passing,
    average: Number(average.toFixed(3)),
    regressions: regressions.length,
  };
}

function configPathGuess(args, defaultResultFile) {
  const config = loadConfig(args.configPath);
  if (args.resultFile || args._positional0) {
    return args.resultFile ? path.resolve(args.resultFile) : path.resolve(args._positional0);
  }
  return path.join(process.cwd(), config.defaults.resultDir, defaultResultFile);
}

function validateAgentRegression(argv = []) {
  const args = parseArgs(argv);
  const currentPath = path.resolve(args.current || args._positional0);
  const currentPayload = normalizeEvaluationPayload(readJson(currentPath));
  const currentSuite = String(currentPayload?.[0]?.suite || "architect");
  const defaultBaseline = path.join(path.dirname(currentPath), "baselines", `${currentSuite}.json`);
  const basePath = path.resolve(args.baseline || args.baselineFile || defaultBaseline);
  const config = loadConfig(args.configPath);
  const current = currentPayload[0];
  const baseline = normalizeEvaluationPayload(readJson(basePath))[0];
  const outputPath = path.join(path.dirname(currentPath), "baseline-regression.json");

  if (!current) {
    const result = { passed: false, blocking_regressions: ["missing current evaluation"] };
    writeJson(outputPath, result);
    return result;
  }
  if (!baseline) {
    const result = {
      passed: true,
      blocking_regressions: [],
      reason: "baseline missing",
      details: `Expected baseline at ${basePath}`,
      suite: currentSuite,
    };
    writeJson(outputPath, result);
    return result;
  }
  const currentScore = Number(current.score || 0);
  const baselineScore = Number(baseline.score || 0);
  const pointDrop = baselineScore - currentScore;
  const percentDrop = baselineScore ? (pointDrop / baselineScore) * 100 : 0;
  const blocking = [];
  const threshold = config.defaults.regression;
  if (pointDrop > Number(threshold.max_drop_points || 0)) {
    blocking.push(`score dropped by ${pointDrop} points`);
  }
  if (percentDrop > Number(threshold.max_drop_percent || 0)) {
    blocking.push(`score dropped by ${percentDrop.toFixed(2)}%`);
  }

  const result = {
    passed: blocking.length === 0,
    blocking_regressions: blocking,
    current_score: currentScore,
    baseline_score: baselineScore,
    point_drop: pointDrop,
    percent_drop: Number(percentDrop.toFixed(3)),
    suite: current.suite || "unknown",
  };
  writeJson(outputPath, result);
  return result;
}

function evaluateTaskContext(argv = []) {
  const args = parseArgs(argv);
  const repositoryRoot = path.resolve(args.repositoryRoot || process.cwd());
  const taskId = String(args.taskId || args._positional0 || "").toUpperCase();
  const suiteCases = [{ id: "task", query: `task ${taskId}` }];
  const context = collectArtifacts(repositoryRoot, suiteCases);
  const allTasks = context.tasks.filter((row) => taskId ? row.id === taskId : true);
  const relatedDependencies = context.dependencies.filter((row) => row.from === taskId || row.to === taskId);
  const relatedTasks = new Set([taskId]);
  for (const row of relatedDependencies) {
    relatedTasks.add(row.from);
    relatedTasks.add(row.to);
  }

  const repoPaths = [];
  const repoIntContext = context.repoIntelligence?.find_context_for_task
    ? context.repoIntelligence.find_context_for_task({
        repositoryRoot,
        taskId,
        profile: "coder",
        limit: 40,
      })
    : null;
  const listedFiles = [];
  if (repoIntContext?.files) {
    for (const row of repoIntContext.files) listedFiles.push(row.path || row.file);
  }
  if (allTasks.length > 0) {
    for (const task of allTasks) {
      repoPaths.push(task.repository || ".");
      for (const file of task.files || []) listedFiles.push(file);
    }
  }
  const uniqueFiles = [...new Set(listedFiles.filter(Boolean))];
  const score = clamp01(0.3 + 0.14 * uniqueFiles.length + (relatedDependencies.length ? 0.2 : 0));
  const outputDir = path.resolve(repositoryRoot, args.resultDir || "evaluations");
  const outputPath = path.join(outputDir, DEFAULT_TASK_EVAL_FILE);
  const md = [
    "# Task Context Evaluation",
    `Task: ${taskId || "n/a"}`,
    `Score: ${Math.round(score * 100)}`,
    `Generated: ${now()}`,
    "",
    "## Files included",
    ...uniqueFiles.map((row) => `- ${row}`),
    "",
    "## Related dependencies",
    ...relatedDependencies.map((row) => `- ${row.from} -> ${row.to} (${row.type})`),
    "",
    "## Related tasks",
    ...[...relatedTasks].map((row) => `- ${row}`),
  ];
  if (repoIntContext?.documentation) {
    md.push("", "## Repository intelligence docs");
    for (const doc of repoIntContext.documentation) {
      const pathValue = doc.path || doc.file || "";
      if (pathValue) md.push(`- ${pathValue}`);
    }
  }
  writeText(outputPath, `${md.join("\n")}\n`);
  return {
    taskId,
    score: Number((score * 100).toFixed(2)),
    pass: score >= 0.65,
    files: uniqueFiles,
    dependencies: relatedDependencies,
    related_tasks: [...relatedTasks],
    outputPath,
  };
}

function evaluateReviewQuality(argv = []) {
  const args = parseArgs(argv);
  const repositoryRoot = path.resolve(args.repositoryRoot || process.cwd());
  const suiteCases = [{ id: "review", query: `review ${String(args.taskId || "")}` }];
  const context = collectArtifacts(repositoryRoot, suiteCases);
  const taskId = String(args.taskId || "").toUpperCase();
  const reviewFile = args.reviewFile || path.join(repositoryRoot, "analysis-results", "review-findings.md");
  const reviewText = readText(reviewFile) || "";
  const findings = context.analysisFindings || [];
  const mentionTotal = findings.length;
  const cited = findings.filter((row) => reviewText.includes(row.id || row.rule || "")).length;
  const bySeverity = findings.reduce((acc, row) => {
    const severity = String(row.severity || "info").toLowerCase();
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});
  const findingQuality = mentionTotal ? clamp01(cited / mentionTotal) : 0.5;
  const falsePositives = clamp01(Math.max(0, 1 - findingQuality));
  const severityAccuracy = clamp01((bySeverity.critical ? 0.4 : 0.2) + (bySeverity.high ? 0.2 : 0.1) + 0.2);
  const missedRate = clamp01(1 - findingQuality);
  const metrics = {
    finding_quality: findingQuality,
    false_positive_rate: clamp01(1 - falsePositives),
    severity_accuracy: severityAccuracy,
    missed_issue_rate: missedRate,
  };
  const score = Math.round(((findingQuality + severityAccuracy + (1 - missedRate) + (1 - falsePositives)) / 4) * 100);

  const outputDir = path.resolve(repositoryRoot, args.resultDir || "evaluations");
  const outputPath = path.join(outputDir, DEFAULT_REVIEW_EVAL_FILE);
  const lines = [
    "# Review Quality Evaluation",
    `Task: ${taskId || "n/a"}`,
    `Generated: ${now()}`,
    `Score: ${score}`,
    "",
    "## Severity",
    `critical: ${bySeverity.critical || 0}`,
    `high: ${bySeverity.high || 0}`,
    `medium: ${bySeverity.medium || 0}`,
    `low: ${bySeverity.low || 0}`,
    `info: ${bySeverity.info || 0}`,
    "",
    `Findings cited: ${cited}/${mentionTotal}`,
    `Task file: ${reviewFile}`,
  ];
  writeText(outputPath, `${lines.join("\n")}\n`);
  return {
    taskId,
    score,
    pass: score >= 70,
    metrics,
    outputPath,
  };
}

function exportEvaluationSummary(argv = []) {
  const args = parseArgs(argv);
  const repositoryRoot = path.resolve(args.repositoryRoot || process.cwd());
  const resultPath = path.resolve(args.resultFile || args._positional0 || path.join(repositoryRoot, "evaluations", DEFAULT_RESULT_FILE));
  const payload = normalizeEvaluationPayload(readJson(resultPath));
  if (payload.length === 0) throw new Error(`No evaluation payload found at ${resultPath}`);
  const outputDir = path.dirname(resultPath);
  const outputPath = path.join(outputDir, args.outputFile || DEFAULT_SUMMARY_FILE);
  const lines = [];
  lines.push("# Evaluation Summary");
  lines.push(`Generated: ${now()}`);
  lines.push(`Evaluations: ${payload.length}`);
  for (const row of payload) {
    lines.push(`- ${row.suite}: ${row.score}/${row.max_score} (${row.pass ? "pass" : "fail"})`);
    if (Array.isArray(row.tasks) && row.tasks.length > 0) {
      lines.push(`  tasks: ${row.tasks.join(", ")}`);
    }
    if (typeof row.estimated_tokens === "number") {
      lines.push(`  estimated_tokens: ${row.estimated_tokens}`);
    }
  }
  lines.push("");
  const metricLines = [];
  for (const row of payload) {
    metricLines.push(`## ${row.suite}`);
    for (const [metric, value] of Object.entries(row.metrics || {})) {
      metricLines.push(`- ${metric}: ${value}`);
    }
    metricLines.push("");
  }
  lines.push(...metricLines);

  writeText(outputPath, `${lines.join("\n")}\n`);
  return {
    outputPath,
    generated_at: now(),
    totalScore: payload.reduce((acc, row) => acc + row.score, 0),
  };
}

module.exports = {
  // helpers
  readJson,
  writeJson,
  parseArgs,
  loadConfig,
  loadSuite,
  resolveProfile,
  loadProvider,
  collectArtifacts,
  // top-level commands
  runEvaluation,
  compareEvaluations,
  generateScorecard,
  validateAgentRegression,
  evaluateTaskContext,
  evaluateReviewQuality,
  exportEvaluationSummary,
};
