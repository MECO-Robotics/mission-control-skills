const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const DEFAULT_CONFIG_PATH = path.join(__dirname, "..", "analyzer-config.json");
const DEFAULT_SEVERITY_MAP_PATH = path.join(__dirname, "..", "severity-mapping.json");
const DEFAULT_BASELINE_DIR = "analysis-baselines";
const DEFAULT_RESULT_DIR = "analysis-results";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeIfNeeded(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const attempt = childProcess.spawnSync(checker, [command], { encoding: "utf8" });
  return attempt.status === 0;
}

function normalizeSeverity(raw, config, source = "") {
  const level = String(raw || "").toLowerCase().trim();
  const map = readJson(DEFAULT_SEVERITY_MAP_PATH) || {};
  const bySource = map.analyzers?.[String(source || "").toLowerCase()] || {};
  for (const canonical of Object.keys(map.severity || {})) {
    if ((map.severity?.[canonical] || []).includes(level)) {
      return canonical;
    }
  }
  for (const canonical of Object.keys(bySource)) {
    if ((bySource[canonical] || []).includes(level)) {
      return canonical;
    }
  }
  return map.default || "info";
}

function stableFindingId(finding) {
  const source = String(finding.source || "").toLowerCase();
  const repository = String(finding.repository || "");
  const file = String(finding.file || "");
  const line = Number(finding.line || 0);
  const rule = String(finding.rule || "");
  const message = String(finding.message || "").trim();
  return [
    source,
    repository,
    file,
    line,
    rule,
    message,
  ]
    .map((value) => value.replace(/[\n\r]/g, " ").trim())
    .filter(Boolean)
    .join("|");
}

function normalizeFinding(raw, source, sourceRepo) {
  const file = normalizePath(raw.file || raw.path || raw.location?.file || raw.fpath || raw.filename || "");
  const line = raw.line || raw.start?.line || raw.location?.start?.line || 0;
  const rule = String(raw.rule || raw.check_id || raw.code || raw.id || "");
  const message = String(raw.message || raw.fingerprint || raw.extra?.message || "");
  const recommendation = String(raw.recommendation || raw.fix || raw.extra?.fix || raw.extra?.replacement || "");
  const category = String(
    raw.category ||
      raw.extra?.metadata?.category ||
      raw.metadata?.category ||
      (message.includes("security") ? "security" : ""),
  ).trim();
  const confidence = String(raw.confidence || raw.extra?.metadata?.confidence || raw.extra?.metadata?.likelihood || "").toLowerCase() || "low";

  return {
    id: raw.id || `finding-${stableFindingId({ source, repository: sourceRepo, file, line, rule, message })}`,
    source,
    repository: sourceRepo || "",
    file,
    line: Number(line || 0),
    severity: normalizeSeverity(raw.severity || raw.level || raw.extra?.severity, null, source),
    category: category || "general",
    rule,
    message: message || "No message",
    recommendation: recommendation || "Review and apply safe implementation",
    confidence: confidence || "low",
    metadata: {
      ...(raw.metadata || {}),
      ...(raw.extra?.metadata || {}),
      source,
    },
  };
}

function normalizePath(value) {
  if (!value) return "";
  return String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizeProfile(raw = {}) {
  return {
    name: raw.name || "coder",
    enabledAnalyzers: Array.isArray(raw.enabledAnalyzers) ? raw.enabledAnalyzers : ["semgrep"],
    block: {
      critical: raw.block?.critical !== false,
      high: raw.block?.high !== false,
      medium: raw.block?.medium === true,
      low: raw.block?.low === true,
      info: raw.block?.info === true,
    },
    rules: Array.isArray(raw.rules) ? raw.rules : ["default"],
  };
}

function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = readJson(configPath);
  if (!raw) throw new Error(`Static analysis config missing: ${configPath}`);
  const profiles = {};
  for (const [name, profile] of Object.entries(raw.profiles || {})) {
    profiles[name] = normalizeProfile(profile);
  }
  return {
    profiles,
    analyzers: raw.analyzers || {},
    defaults: {
      baselineDir: raw.defaults?.baselineDir || DEFAULT_BASELINE_DIR,
      resultDir: raw.defaults?.resultDir || DEFAULT_RESULT_DIR,
      severity: raw.defaults?.severity || "medium",
      maxFindingLine: raw.defaults?.maxFindingLine || 10000,
    },
  };
}

function loadProvider(name, config) {
  const key = String(name).toLowerCase();
  if (key === "semgrep") {
    return createSemgrepProvider(config);
  }
  return null;
}

function createSemgrepProvider(config) {
  const providerConfig = config.analyzers?.semgrep || {};
  const binary = process.env.SEMGREP_BIN || providerConfig.binary || "semgrep";
  const extraArgs = Array.isArray(providerConfig.extraArgs) ? providerConfig.extraArgs : ["--config", "auto"];

  function isAvailable() {
    if (providerConfig.enabled === false) return false;
    return commandExists(binary);
  }

  function run(repositoryRoot, options = {}, profile = {}) {
    if (!isAvailable()) return { available: false, findings: [], outputPath: null, error: "semgrep binary unavailable" };
    const args = [...extraArgs];
    const profileRule = pickProfileRule(options.profileRules || profile.name || "default");
    if (profileRule) {
      args.push("-c", profileRule);
    }
    for (const rule of options.customRules || []) {
      args.push("-c", rule);
    }
    args.push("--json", "--quiet", ".");

    const runOptions = {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: providerConfig.timeoutMs || 120000,
      maxBuffer: 20 * 1024 * 1024,
    };

    const result = childProcess.spawnSync(binary, args, runOptions);
    if (result.error) {
      return { available: false, findings: [], outputPath: null, error: String(result.error) };
    }

    const output = result.stdout || result.stderr || "";
    return {
      available: true,
      command: `${binary} ${args.join(" ")}`,
      raw: output,
      exitCode: result.status,
    };
  }

  function parse(output) {
    if (!output) return [];
    let parsed = null;
    try {
      parsed = JSON.parse(String(output));
    } catch {
      return [];
    }
    if (!parsed || !Array.isArray(parsed.results)) {
      return [];
    }
    return parsed.results
      .map((entry) => {
        const file = normalizePath(entry.path?.text || entry.path || entry.location?.path);
        const line = entry.start?.line || entry.end?.line || entry.extra?.line || 0;
        return normalizeFinding(
          {
            source: "semgrep",
            file,
            line,
            rule: entry.check_id || "semgrep-rule",
            message: entry.extra?.message || entry.message || entry.error || "Semgrep finding",
            recommendation: entry.extra?.fix || entry.extra?.metavars?.pattern || "Apply fix described by Semgrep",
            severity: entry.extra?.severity || entry.extra?.metadata?.severity || entry.metadata?.severity,
            confidence: entry.extra?.metadata?.confidence || "medium",
            category: entry.extra?.metadata?.category || "security",
            metadata: {
              raw: entry,
            },
          },
          "semgrep",
          entry.path?.repo || entry.repository || "",
        );
      })
      .filter((finding) => finding.file || finding.message)
      .map((row, idx) => ({
        ...row,
        id: row.id || `semgrep-${idx + 1}`,
      }));
  }

  function pickProfileRule(profileName = "default") {
    const rules = String(profileName || "").toLowerCase() + ".yml";
    const base = path.join(__dirname, "..", "analyzers", "semgrep", "profiles", rules);
    if (fs.existsSync(base)) {
      return base;
    }
    const fallback = path.join(__dirname, "..", "analyzers", "semgrep", "rules", "default.yml");
    return fs.existsSync(fallback) ? fallback : null;
  }

  return {
    name: "semgrep",
    isAvailable,
    run,
    parse,
  };
}

function ensureBaselineFile(baselinePath) {
  if (fs.existsSync(baselinePath)) return;
  writeJson(baselinePath, {
    generated_at: new Date().toISOString(),
    profile: null,
    fingerprints: [],
  });
}

function baselineFingerprint(findings) {
  return findings
    .map((row) => `${row.repository}#${row.file}#${row.line}#${row.rule}#${row.message}`)
    .sort();
}

function loadBaseline(repositoryRoot, profileName, config) {
  const baselineDir = path.join(repositoryRoot, config.defaults.baselineDir);
  const baselinePath = path.join(baselineDir, `${profileName}.json`);
  const baseline = readJson(baselinePath);
  if (!baseline) {
    ensureBaselineFile(baselinePath);
    return { path: baselinePath, fingerprints: new Set(), raw: { findings: [] } };
  }
  const list =
    Array.isArray(baseline.fingerprints) && baseline.fingerprints.length > 0
      ? baseline.fingerprints
      : Array.isArray(baseline.findings)
        ? baseline.findings
            .map((finding) => {
              if (typeof finding === "string") return finding;
              if (!finding || typeof finding !== "object") return null;
              return `${finding.repository}#${finding.file}#${finding.line}#${finding.rule}#${finding.message}`;
            })
            .filter(Boolean)
        : [];
  return {
    path: baselinePath,
    raw: baseline,
    fingerprints: new Set(list),
  };
}

function classifyBySeverity(findings) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    const key = SEVERITY_ORDER.includes(finding.severity) ? finding.severity : "info";
    counts[key] += 1;
  }
  return counts;
}

function compareFindings(current, previous) {
  const byId = new Map();
  for (const finding of previous) byId.set(finding.id, finding);
  const currentById = new Map();
  for (const finding of current) currentById.set(finding.id, finding);

  const newFindings = current.filter((f) => !byId.has(f.id));
  const resolvedFindings = previous.filter((f) => !currentById.has(f.id));

  const severityDirection = [];
  for (const finding of current) {
    const prior = byId.get(finding.id);
    if (!prior) continue;
    if (prior.severity !== finding.severity) {
      severityDirection.push({
        findingId: finding.id,
        from: prior.severity,
        to: finding.severity,
      });
    }
  }

  return {
    newFindings,
    resolvedFindings,
    severityChanges: severityDirection,
  };
}

function runAnalysis(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const profileName = options.profile || "coder";
  const config = loadConfig(options.configPath);
  const profile = config.profiles?.[profileName] || normalizeProfile(config.profiles?.coder || {});
  const resultDir = path.join(repositoryRoot, options.resultDir || config.defaults.resultDir);
  const branch = options.branch || "default";

  const allFindings = [];
  const analyzerFailures = [];
  const discoveredByAnalyzer = {};

  const customRules = resolveRulePaths(profile.rules, options.ruleSets, repositoryRoot);
  for (const analyzerName of profile.enabledAnalyzers || []) {
    const provider = loadProvider(analyzerName, config);
    if (!provider) {
      analyzerFailures.push({ analyzer: analyzerName, reason: "unsupported analyzer" });
      continue;
    }
    const scan = provider.run(repositoryRoot, { customRules, profileRules: profile.rules }, profile);
    if (!scan || !scan.available) {
      analyzerFailures.push({ analyzer: analyzerName, reason: scan?.error || "not available" });
      continue;
    }
    const normalized = provider.parse(scan.raw);
    discoveredByAnalyzer[analyzerName] = {
      command: scan.command,
      exitCode: scan.exitCode,
      findingsCount: normalized.length,
    };
    for (const row of normalized) {
      allFindings.push({
        ...row,
        repository: row.repository || ".",
      });
    }
  }

  const branchTag = branch ? String(branch) : "default";
  const seen = new Set();
  const findings = [];
  for (const finding of allFindings) {
    const id = findStableId(finding);
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      ...finding,
      id,
      metadata: {
        ...finding.metadata,
        profile: profileName,
        repositoryRoot,
        branch: branchTag,
      },
      repository: normalizePath(finding.repository || "."),
    });
  }

  findings.sort((a, b) => {
    if (a.severity !== b.severity) {
      return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    }
    return `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`);
  });

  const baseline = loadBaseline(repositoryRoot, profileName, config);
  const baselineSet = baseline.fingerprints;
  const historical = [];
  const newAgainstBaseline = [];
  for (const finding of findings) {
    const fingerprint = `${finding.repository}#${finding.file}#${finding.line}#${finding.rule}#${finding.message}`;
    if (baselineSet.has(fingerprint)) {
      historical.push(finding.id);
    } else {
      newAgainstBaseline.push(finding.id);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    profile: profileName,
    repository: repositoryRoot,
    branch: branchTag,
    totals: {
      findings: findings.length,
      historical: historical.length,
      new: newAgainstBaseline.length,
    },
    severityCounts: classifyBySeverity(findings),
    repositoryCount: new Set(findings.map((finding) => finding.repository || ".")).size,
    analyzedBy: discoveredByAnalyzer,
    analyzerFailures,
    mode: findings.length > 0 ? "analyzed" : "no-findings",
  };

  writeJson(path.join(resultDir, "summary.json"), summary);
  writeJson(path.join(resultDir, "findings.json"), {
    generated_at: summary.generated_at,
    profile: profileName,
    repository: repositoryRoot,
    branch: branch,
    findings,
    baseline: {
      matched: historical.length,
      fingerprints: [...baselineSet],
    },
    summary,
  });
  writeIfNeeded(path.join(resultDir, "findings.md"), generateFindingsMarkdown({ findings, repositoryRoot, summary }));

  return {
    resultDir,
    summary,
    findingCount: findings.length,
    findings,
    newFindings: newAgainstBaseline.length,
    analyzerFailures,
    profile: profileName,
  };
}

function parseAnalysisResults(options = {}) {
  const rawPath = path.resolve(options.inputPath || "");
  const source = readJson(rawPath);
  if (!source) throw new Error(`Cannot read analysis output: ${rawPath}`);
  const profileName = options.profile || "coder";
  const analyzer = options.analyzer || "semgrep";

  if (analyzer === "semgrep") {
    const provider = createSemgrepProvider(loadConfig(options.configPath));
    const parsed = provider.parse(typeof source === "string" ? source : JSON.stringify(source));
    return {
      profile: profileName,
      analyzer,
      findings: parsed,
    };
  }

  const findings = Array.isArray(source.findings) ? source.findings : [];
  return {
    profile: profileName,
    analyzer,
    findings,
  };
}

function generateReviewFindings(options = {}) {
  const findingPath = path.resolve(options.findingFile || path.join(process.cwd(), DEFAULT_RESULT_DIR, "findings.json"));
  const payload = readJson(findingPath);
  if (!payload) {
    throw new Error(`Unable to read findings from ${findingPath}`);
  }
  const findings = Array.isArray(payload.findings) ? payload.findings : [];

  const bySeverity = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const finding of findings) {
    const severity = SEVERITY_ORDER.includes(finding.severity) ? finding.severity : "info";
    if (!bySeverity[severity]) bySeverity[severity] = [];
    bySeverity[severity].push(finding);
  }

  const repositories = {};
  const categories = {};
  for (const finding of findings) {
    const repository = finding.repository || "unknown";
    const category = finding.category || "general";
    repositories[repository] = repositories[repository] || [];
    categories[category] = categories[category] || [];
    repositories[repository].push(finding);
    categories[category].push(finding);
  }

  const lines = [];
  lines.push("# Review Findings");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Total findings: ${findings.length}`);
  lines.push("\n## By severity");
  for (const severity of SEVERITY_ORDER) {
    const list = bySeverity[severity] || [];
    if (list.length === 0) continue;
    lines.push(`\n### ${severity} (${list.length})`);
    const grouped = {};
    for (const finding of list) {
      const repository = finding.repository || "unknown";
      grouped[repository] = grouped[repository] || [];
      grouped[repository].push(finding);
    }
    for (const [repository, rows] of Object.entries(grouped)) {
      lines.push(`\n#### ${repository}`);
      const byCategory = {};
      for (const row of rows) {
        const category = row.category || "general";
        byCategory[category] = byCategory[category] || [];
        byCategory[category].push(row);
      }
      for (const [category, items] of Object.entries(byCategory)) {
        lines.push(`\n- ${category}`);
        for (const row of items) {
          lines.push(
            `  - ${row.id}: ${row.rule} @ ${row.file}:${row.line} [${row.confidence}]`,
          );
          if (row.message) lines.push(`    - explanation: ${row.message}`);
          if (row.recommendation) lines.push(`    - suggested fix: ${row.recommendation}`);
        }
      }
    }
  }

  const outputPath = path.resolve(options.outputFile || path.join(path.dirname(findingPath), "review-findings.md"));
  writeIfNeeded(outputPath, `${lines.join("\n")}\n`);

  return {
    outputPath,
    findingCount: findings.length,
    bySeverity: {
      critical: (bySeverity.critical || []).length,
      high: (bySeverity.high || []).length,
      medium: (bySeverity.medium || []).length,
      low: (bySeverity.low || []).length,
      info: (bySeverity.info || []).length,
    },
    repositories,
    categories,
  };
}

function generateFixLoop(options = {}) {
  const findingPath = path.resolve(options.findingFile || path.join(process.cwd(), DEFAULT_RESULT_DIR, "findings.json"));
  const payload = readJson(findingPath);
  if (!payload) throw new Error(`Unable to read findings: ${findingPath}`);

  const repository = options.repository || null;
  const candidates = (Array.isArray(payload.findings) ? payload.findings : [])
    .filter((finding) => !repository || finding.repository === repository);
  const packages = candidates.map((finding) => ({
    finding_id: finding.id,
    repository: finding.repository || repository || "",
    file: finding.file,
    severity: finding.severity,
    rule: finding.rule,
    fix_objective: finding.recommendation || "Address static finding with minimal behavior change",
  }));

  packages.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const outPath = path.resolve(options.outputFile || path.join(path.dirname(findingPath), "fix-packages.json"));
  writeJson(outPath, {
    generated_at: new Date().toISOString(),
    findingCount: packages.length,
    packages,
  });
  return { outputPath: outPath, packages };
}

function compareRuns(options = {}) {
  const previousPath = path.resolve(options.previous || "");
  const currentPath = path.resolve(options.current || options.findingFile || path.join(process.cwd(), DEFAULT_RESULT_DIR, "findings.json"));
  const previous = readJson(previousPath);
  const current = readJson(currentPath);
  if (!previous || !current) {
    throw new Error("both previous and current findings must exist");
  }
  const prevFindings = Array.isArray(previous.findings) ? previous.findings : [];
  const currFindings = Array.isArray(current.findings) ? current.findings : [];

  const diff = compareFindings(currFindings, prevFindings);
  const out = {
    generated_at: new Date().toISOString(),
    previous: previousPath,
    current: currentPath,
    new: diff.newFindings,
    resolved: diff.resolvedFindings,
    severityIncreases: diff.severityChanges.filter((row) => isSeverityIncrease(row.from, row.to)),
    severityDecreases: diff.severityChanges.filter((row) => isSeverityDecrease(row.from, row.to)),
    unchanged: currFindings.filter((f) => prevFindings.some((p) => p.id === f.id)).length,
  };

  const outputPath = path.resolve(options.outputFile || path.join(path.dirname(currentPath), "analysis-delta.md"));
  const lines = [];
  lines.push("# Analysis Delta");
  lines.push(`Generated: ${out.generated_at}`);
  lines.push(`Current: ${currentPath}`);
  lines.push(`Previous: ${previousPath}`);
  lines.push(`New findings: ${out.new.length}`);
  lines.push(`Resolved findings: ${out.resolved.length}`);
  lines.push(`Severity increases: ${out.severityIncreases.length}`);
  lines.push(`Severity decreases: ${out.severityDecreases.length}`);
  lines.push("\n## New findings");
  for (const row of out.new) {
    lines.push(`- ${row.id} ${row.file || ""} (${row.severity})`);
  }
  lines.push("\n## Resolved findings");
  for (const row of out.resolved) {
    lines.push(`- ${row.id} ${row.file || ""} (${row.severity})`);
  }
  writeIfNeeded(outputPath, `${lines.join("\n")}\n`);
  return { outputPath, delta: out };
}

function validateMergeReadiness(options = {}) {
  const findingPath = path.resolve(options.findingFile || path.join(process.cwd(), DEFAULT_RESULT_DIR, "findings.json"));
  const payload = readJson(findingPath);
  if (!payload) throw new Error(`Could not read findings: ${findingPath}`);
  const config = loadConfig(options.configPath);
  const profileName = options.profile || payload.profile || "coder";
  const profile = config.profiles?.[profileName] || normalizeProfile(config.profiles?.coder || {});

  const allFindings = Array.isArray(payload.findings) ? payload.findings : [];
  const prContext = loadPrContext(path.dirname(findingPath), options.pr, allFindings);

  const baseline = loadBaseline(path.dirname(findingPath), profileName, config);
  const blocked = allFindings
    .filter((row) => isBlocking(row, profile.block, baseline.fingerprints))
    .filter((row) => !prContext || prContext.files.length === 0 || prContext.files.includes(row.file));

  return {
    merge_ready: blocked.length === 0,
    blocking_findings: blocked.map((row) => ({
      id: row.id,
      repository: row.repository,
      file: row.file,
      line: row.line,
      severity: row.severity,
      rule: row.rule,
      message: row.message,
      reason: "severity threshold + policy",
      source: row.source,
      category: row.category,
    })),
    policy: profile.block,
    totals: {
      findings: allFindings.length,
      blocking: blocked.length,
    },
  };
}

function exportAnalysisSummary(options = {}) {
  const findingPath = path.resolve(options.findingFile || path.join(process.cwd(), DEFAULT_RESULT_DIR, "findings.json"));
  const payload = readJson(findingPath);
  if (!payload) throw new Error(`Could not read findings: ${findingPath}`);
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const config = loadConfig(options.configPath);
  const profileName = options.profile || payload.profile || "coder";
  const previous = options.previous ? readJson(path.resolve(options.previous)) : null;

  const bySeverity = classifyBySeverity(findings);
  const byRepository = {};
  const byCategory = {};
  for (const finding of findings) {
    const repository = finding.repository || "unknown";
    const category = finding.category || "general";
    byRepository[repository] = (byRepository[repository] || 0) + 1;
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  const outputPath = path.resolve(options.outputFile || path.join(path.dirname(findingPath), "analysis-summary.md"));
  const lines = [];
  lines.push("# Analysis Summary");
  lines.push(`Profile: ${profileName}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Repository artifacts: ${path.dirname(path.dirname(findingPath))}`);
  lines.push(`Total findings: ${findings.length}`);
  lines.push("");
  lines.push("## By severity");
  for (const severity of SEVERITY_ORDER) {
    lines.push(`- ${severity}: ${bySeverity[severity] || 0}`);
  }
  lines.push("## By category");
  for (const [category, count] of Object.entries(byCategory)) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push("## Repositories");
  for (const [repository, count] of Object.entries(byRepository)) {
    lines.push(`- ${repository}: ${count}`);
  }

  if (previous) {
    const previousFindings = Array.isArray(previous.findings) ? previous.findings : [];
    const prevSev = classifyBySeverity(previousFindings);
    lines.push("## Trend vs previous");
    for (const severity of SEVERITY_ORDER) {
      const delta = (bySeverity[severity] || 0) - (prevSev[severity] || 0);
      const sign = delta >= 0 ? "+" : "";
      lines.push(`- ${severity}: ${sign}${delta}`);
    }
  }

  const merge = validateMergeReadiness({
    findingFile: findingPath,
    profile: profileName,
    configPath: options.configPath,
    pr: options.pr,
  });
  lines.push("## Merge readiness");
  lines.push(`Merge ready: ${merge.merge_ready}`);
  lines.push(`Blocking findings: ${merge.blocking_findings.length}`);

  writeIfNeeded(outputPath, `${lines.join("\n")}\n`);
  return {
    outputPath,
    metrics: {
      total: findings.length,
      severity: bySeverity,
      categoryCount: byCategory,
      repositoryCount: byRepository,
      merge,
    },
  };
}

function isSeverityIncrease(previous, next) {
  const rank = severityRank(previous);
  const nextRank = severityRank(next);
  return nextRank < rank;
}

function isSeverityDecrease(previous, next) {
  const rank = severityRank(previous);
  const nextRank = severityRank(next);
  return nextRank > rank;
}

function severityRank(value) {
  const index = SEVERITY_ORDER.indexOf(String(value || "info").toLowerCase());
  return index < 0 ? SEVERITY_ORDER.length : index;
}

function isBlocking(finding, policy, baselineSet = new Set()) {
  const normalizedSeverity = SEVERITY_ORDER.includes(finding.severity) ? finding.severity : "info";
  const fingerprint = `${finding.repository}#${finding.file}#${finding.line}#${finding.rule}#${finding.message}`;
  if (baselineSet.has(fingerprint)) {
    return false;
  }
  return policy[normalizedSeverity] === true;
}

function resolveRulePaths(profileRules = [], overrideRules = [], repositoryRoot = process.cwd()) {
  const requested = [...profileRules, ...Array.isArray(overrideRules) ? overrideRules : []];
  return requested
    .map((entry) => {
      const candidatePath = path.resolve(
        repositoryRoot,
        "integrations/static-analysis/analyzers/semgrep/rules",
        `${String(entry || "").replace(/[\/.]$/, "").trim()}.yml`,
      );
      return fs.existsSync(candidatePath) ? candidatePath : null;
    })
    .filter(Boolean);
}

function findStableId(finding) {
  const base = `${finding.source || ""}|${finding.repository || ""}|${finding.file || ""}|${finding.line || 0}|${finding.rule || ""}|${finding.message || ""}`;
  const crypto = require("crypto");
  return `${normalizePath(finding.source || "")}-${crypto.createHash("sha1").update(base).digest("hex")}`;
}

function loadPrContext(repositoryRoot, prValue, findings) {
  if (!prValue) return { files: [] };
  const prId = String(prValue);
  const candidates = [
    path.join(repositoryRoot, "pr-data", `pr-${prId}.json`),
    path.join(repositoryRoot, "global-prs.json"),
    path.join(repositoryRoot, "pull-requests.json"),
    path.join(repositoryRoot, "git-nexus.json"),
  ];
  for (const candidate of candidates) {
    const data = readJson(candidate);
    if (!data) continue;
    const matched = locatePrRecord(data, prId);
    if (!matched) continue;
    const files = Array.isArray(matched.changedFiles) ? matched.changedFiles.map(normalizePath) : [];
    return { files };
  }
  return { files: [] };
}

function locatePrRecord(data, prId) {
  if (!data) return null;
  if (Array.isArray(data)) {
    return data.find((row) => String(row.number || row.id || "") === String(prId));
  }
  if (Array.isArray(data.prs)) {
    return data.prs.find((row) => String(row.number || row.id || "") === String(prId));
  }
  if (String(data.number || "") === String(prId)) {
    return data;
  }
  return null;
}

function generateFindingsMarkdown({ findings, repositoryRoot, summary }) {
  const lines = [];
  lines.push("# Static Analysis Findings");
  lines.push(`Generated: ${summary.generated_at}`);
  lines.push(`Profile: ${summary.profile}`);
  lines.push(`Repository: ${repositoryRoot}`);
  lines.push(`Total findings: ${findings.length}`);
  for (const severity of SEVERITY_ORDER) {
    const rows = findings.filter((finding) => finding.severity === severity);
    if (rows.length === 0) continue;
    lines.push(`\n## ${severity.toUpperCase()} (${rows.length})`);
    for (const row of rows) {
      lines.push(`- ${row.id}: ${row.file}:${row.line} [${row.source}]`);
      if (row.rule) lines.push(`  - rule: ${row.rule}`);
      if (row.message) lines.push(`  - message: ${row.message}`);
      if (row.recommendation) lines.push(`  - recommendation: ${row.recommendation}`);
      if (row.category) lines.push(`  - category: ${row.category}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function buildAnalysisContextForTask(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const taskId = String(options.taskId || "").toUpperCase();
  const findingPath = path.join(repositoryRoot, options.resultDir || DEFAULT_RESULT_DIR, "findings.json");
  const payload = readJson(findingPath);
  if (!payload) return [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const result = [];
  if (!taskId) return findings;

  for (const finding of findings) {
    const relatedTask = (finding.metadata && String(finding.metadata.taskId || finding.metadata.task || finding.metadata.relatedTask || "")).toUpperCase();
    const content = [finding.rule, finding.message, finding.category, finding.file, finding.metadata?.repositoryPath].join(" ").toLowerCase();
    if (relatedTask === taskId || content.includes(taskId.toLowerCase())) {
      result.push(finding);
    }
  }

  if (result.length === 0) {
    return findings.filter((finding) => String(finding.file || "").toLowerCase().includes(taskId.toLowerCase()));
  }
  return result;
}

function loadStaticAnalysisResults(repositoryRoot, resultDir = DEFAULT_RESULT_DIR) {
  const findingPath = path.join(repositoryRoot, resultDir, "findings.json");
  return readJson(findingPath) || { findings: [] };
}

module.exports = {
  loadConfig,
  runAnalysis,
  parseAnalysisResults,
  generateReviewFindings,
  generateFixLoop,
  compareRuns,
  validateMergeReadiness,
  exportAnalysisSummary,
  buildAnalysisContextForTask,
  loadStaticAnalysisResults,
  createSemgrepProvider,
  loadBaseline,
  compareFindings,
  generateFindingsMarkdown,
};
