const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");

const DEFAULT_PROFILES_PATH = path.join(__dirname, "..", "context-profiles.json");
const DEFAULT_TEMPLATE_PATH = path.join(__dirname, "..", "repomix-config.template.json");

function normalizeProfile(raw) {
  return {
    name: raw.name ?? "custom",
    tokenBudget: raw.tokenBudget ?? 12000,
    outputFormat: raw.outputFormat ?? "xml",
    includeDirectories: Array.isArray(raw.includeDirectories) ? raw.includeDirectories : [],
    includeFiles: Array.isArray(raw.includeFiles) ? raw.includeFiles : [],
    excludeDirectories: Array.isArray(raw.excludeDirectories) ? raw.excludeDirectories : [],
    includeDocumentation: raw.includeDocumentation !== false,
    includeTests: raw.includeTests !== false,
    maxDocumentationFileTokens: raw.maxDocumentationFileTokens ?? 12000,
    documentationSuffixes: Array.isArray(raw.documentationSuffixes)
      ? raw.documentationSuffixes
      : [".md", ".txt", ".rst", ".yaml", ".yml", ".json"],
  };
}

function loadProfiles(profilePath = DEFAULT_PROFILES_PATH) {
  const abs = path.resolve(profilePath);
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw);
  const out = {};
  for (const [name, profile] of Object.entries(parsed.profiles ?? {})) {
    out[name] = normalizeProfile(profile);
  }
  return out;
}

function estimateTokens(content) {
  return Math.max(1, Math.ceil((content?.length ?? 0) / 4));
}

function sha1(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function isBinaryPath(p) {
  const ext = path.extname(p).toLowerCase();
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

function isTestPath(rel) {
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.includes("/test/")) {
    return true;
  }
  return /\.(test|spec)\.[^.]+$/.test(path.basename(normalized));
}

function isDocPath(rel, suffixes) {
  const lower = rel.toLowerCase();
  return suffixes.some((sfx) => lower.endsWith(sfx));
}

function normalizeSegments(root, target) {
  const rootParts = path.resolve(root).split(path.sep).filter(Boolean);
  const targetParts = path.resolve(target).split(path.sep).filter(Boolean);
  let i = 0;
  while (i < rootParts.length && i < targetParts.length && rootParts[i] === targetParts[i]) {
    i += 1;
  }
  const relativeParts = targetParts.slice(i);
  return relativeParts.join(path.sep);
}

function shouldIncludeByPattern(relPath, profile) {
  const normalized = relPath.replace(/\\/g, "/");
  if (profile.includeDirectories.length === 0 && profile.includeFiles.length === 0) {
    return true;
  }
  if (profile.includeFiles.some((name) => normalized === name || normalized.endsWith(`/${name}`))) {
    return true;
  }
  return profile.includeDirectories.some((dir) => {
    const lower = dir.toLowerCase();
    const relLower = normalized.toLowerCase();
    return relLower === lower || relLower.startsWith(`${lower}/`);
  });
}

function shouldIncludeFile(relPath, profile) {
  const normalized = relPath.replace(/\\/g, "/");
  if (profile.excludeDirectories.some((dir) => normalized === dir || normalized.startsWith(`${dir.replace(/\\/g, "/")}/`))) {
    return false;
  }
  if (!shouldIncludeByPattern(normalized, profile)) {
    return false;
  }
  if (!profile.includeTests && isTestPath(normalized)) {
    return false;
  }
  if (!profile.includeDocumentation && isDocPath(normalized, profile.documentationSuffixes)) {
    return false;
  }
  return true;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function readTextSafe(filePath) {
  if (isBinaryPath(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("\u0000")) {
    return null;
  }
  return content;
}

function walkFiles(rootAbs, profile) {
  const files = [];
  const stack = [{ abs: rootAbs, rel: "" }];
  while (stack.length > 0) {
    const current = stack.pop();
    const children = fs.readdirSync(current.abs, { withFileTypes: true });
    for (const child of children) {
      if (child.name === ".git" || child.name === "node_modules") {
        continue;
      }
      const childAbs = path.join(current.abs, child.name);
      const childRel = current.rel ? path.join(current.rel, child.name) : child.name;
      const relPosix = childRel.replace(/\\/g, "/");
      if (child.isDirectory()) {
        if (profile.excludeDirectories.some((dir) => relPosix === dir || relPosix.startsWith(`${dir}/`))) {
          continue;
        }
        stack.push({ abs: childAbs, rel: childRel });
        continue;
      }
      if (!child.isFile()) {
        continue;
      }
      if (!shouldIncludeFile(childRel, profile)) {
        continue;
      }
      const stat = fs.statSync(childAbs);
      const content = readTextSafe(childAbs);
      const item = {
        path: childRel,
        abs: childAbs,
        size: stat.size,
        content: content ?? "",
        kind: isDocPath(relPosix, profile.documentationSuffixes) ? "doc" : "code",
      };
      item.tokens = estimateTokens(item.content || "");
      item.sha1 = sha1(item.content || "");
      files.push(item);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function metadataEnvelope({ profile, repositories, tasks, dependencies, files }) {
  const estimatedTokens = files.reduce((sum, f) => sum + f.tokens, 0);
  return {
    generated_at: new Date().toISOString(),
    profile,
    repositories: [...repositories],
    tasks: [...tasks],
    dependencies: [...dependencies],
    estimated_tokens: estimatedTokens,
    file_count: files.length,
  };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateRepoXml({ metadata, files }) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<repoContext>");
  lines.push("  <metadata>");
  lines.push(`    <generated_at>${xmlEscape(metadata.generated_at)}</generated_at>`);
  lines.push(`    <profile>${xmlEscape(metadata.profile)}</profile>`);
  lines.push(`    <estimated_tokens>${metadata.estimated_tokens}</estimated_tokens>`);
  lines.push(`    <file_count>${metadata.file_count}</file_count>`);
  lines.push(`    <repositories>${metadata.repositories.map(xmlEscape).join(",")}</repositories>`);
  lines.push(`    <tasks>${metadata.tasks.map(xmlEscape).join(",")}</tasks>`);
  lines.push(`    <dependencies>${metadata.dependencies.map(xmlEscape).join(",")}</dependencies>`);
  lines.push("  </metadata>");
  lines.push("  <files>");
  for (const file of files) {
    lines.push(
      `    <file path="${xmlEscape(file.path)}" size="${file.size}" tokens="${file.tokens}" kind="${xmlEscape(file.kind)}" sha1="${xmlEscape(file.sha1)}"><![CDATA[${file.content}]]></file>`,
    );
  }
  lines.push("  </files>");
  lines.push("</repoContext>");
  return lines.join("\n");
}

function summarizeFiles(files, outputPath, title) {
  let body = `# ${title}\n\n`;
  const totalTokens = files.reduce((sum, file) => sum + file.tokens, 0);
  body += `Estimated tokens: ${totalTokens}\n`;
  body += `Files included: ${files.length}\n\n`;
  body += `## Files\n\n`;
  for (const file of files) {
    body += `- ${file.path} (${file.tokens} tokens)\n`;
  }
  body += `\nGenerated context file: ${outputPath}\n`;
  return body;
}

function parseTaskRecords(globalIssuesPath) {
  const data = readJson(globalIssuesPath) ?? {};
  const source = Array.isArray(data.tasks) ? data.tasks : [];
  const map = new Map();
  for (const task of source) {
    if (typeof task?.id === "string") {
      map.set(task.id.toUpperCase(), task);
    }
  }
  return map;
}

function parseDependencyMap(dependencyMapPath) {
  const data = readJson(dependencyMapPath) ?? {};
  const rows = Array.isArray(data.dependencies) ? data.dependencies : [];
  const outgoing = new Map();
  for (const row of rows) {
    const from = String(row.from || "").toUpperCase();
    const to = String(row.to || "").toUpperCase();
    if (!from || !to) continue;
    if (!outgoing.has(from)) {
      outgoing.set(from, []);
    }
    outgoing.get(from).push({ to, type: row.type || "related" });
  }
  return outgoing;
}

function collectTaskClosure(startId, taskMap, dependencyMap, depth, seen = new Set(), relationships = []) {
  const id = startId.toUpperCase();
  if (seen.has(id) || depth < 0) {
    return;
  }
  if (!taskMap.has(id)) {
    return;
  }
  seen.add(id);
  const outgoing = dependencyMap.get(id) ?? [];
  for (const edge of outgoing) {
    relationships.push({ from: id, to: edge.to, type: edge.type });
    collectTaskClosure(edge.to, taskMap, dependencyMap, depth - 1, seen, relationships);
  }
}

function collectRepoPaths(taskEntries, repositoryRoot, repoRegistryPath) {
  const registry = readJson(repoRegistryPath);
  const byId = registry && typeof registry === "object" ? registry.repositories || registry : {};
  const mapped = new Set();
  for (const task of taskEntries) {
    const repoId = task.repository || task.repo;
    if (typeof repoId === "string") {
      const repoPath = byId?.[repoId]?.path || repoId;
      mapped.add(path.resolve(repositoryRoot, repoPath));
      continue;
    }
    if (Array.isArray(task.repositories)) {
      for (const idOrPath of task.repositories) {
        mapped.add(path.resolve(repositoryRoot, byId?.[idOrPath]?.path || idOrPath));
      }
    }
  }
  return [...mapped];
}

function loadNexusMetadata(baseDir, taskId, prId) {
  const candidates = [];
  if (taskId) candidates.push(path.join(baseDir, "git-nexus.json"));
  if (prId) candidates.push(path.join(baseDir, "git-nexus-prs.json"));
  for (const file of candidates) {
    const data = readJson(file);
    if (!data) continue;
    if (taskId && data.tasks && Array.isArray(data.tasks)) {
      return data;
    }
    if (prId && data.prs && Array.isArray(data.prs)) {
      return data;
    }
  }
  return null;
}

function loadWikiMetadata(baseDir, taskId) {
  const file = path.join(baseDir, "git-wiki.json");
  const data = readJson(file);
  if (!data) {
    return null;
  }
  if (!taskId) {
    return data;
  }
  const matched = [];
  if (Array.isArray(data.decisions)) {
    for (const row of data.decisions) {
      if (String(row.taskId || "").toUpperCase() === taskId.toUpperCase()) {
        matched.push(row);
      }
    }
  }
  return { ...data, decisions: matched };
}

function writeIfNeeded(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const check = childProcess.spawnSync(checker, [command], { encoding: "utf8" });
  return check.status === 0;
}

function runRepomixOptional(opts) {
  const bin = opts.repomixBinary || process.env.REPOMIX_BIN || "repomix";
  if (!commandExists(bin)) {
    return { used: false };
  }
  const attempts = [];
  const base = [];
  if (opts.configPath) {
    base.push("--config", opts.configPath);
    base.push("-c", opts.configPath);
  }
  base.push(opts.repositoryPath);
  base.push("--output", opts.outputPath);
  if (base.length > 0) {
    attempts.push(base);
  }
  attempts.push([opts.repositoryPath, opts.outputPath]);
  for (const attempt of attempts) {
    const run = childProcess.spawnSync(bin, attempt, {
      cwd: opts.repositoryPath,
      encoding: "utf8",
    });
    if (run.status !== 0) {
      continue;
    }
    if (fs.existsSync(opts.outputPath)) {
      return { used: true, outputPath: opts.outputPath, command: `${bin} ${attempt.join(" ")}` };
    }
  }
  return { used: false, reason: "repomix output not found" };
}

function writeTokenReport(filePath, metadata, files, profile, repomixUsed) {
  const summary = {
    generated_at: metadata.generated_at,
    profile: profile,
    repositories: metadata.repositories,
    tasks: metadata.tasks,
    dependencies: metadata.dependencies,
    estimated_tokens: metadata.estimated_tokens,
    file_count: metadata.file_count,
    repomix_used: repomixUsed,
    files: files.map((file) => ({
      path: file.path,
      size: file.size,
      tokens: file.tokens,
      sha1: file.sha1,
      kind: file.kind,
    })),
  };
  writeIfNeeded(filePath, JSON.stringify(summary, null, 2));
  return summary;
}

function buildRepoContext(options) {
  const profileName = options.profile || "coder";
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown profile '${profileName}'.`);
  }
  const repositoryPath = path.resolve(options.repositoryPath || process.cwd());
  const outDir = path.resolve(options.outputDir || path.join(repositoryPath, "generated-context"));
  const files = walkFiles(repositoryPath, profile);
  const metadata = metadataEnvelope({
    profile: profileName,
    repositories: [normalizeSegments(process.cwd(), repositoryPath)],
    tasks: [],
    dependencies: [],
    files,
  });
  const configPath = path.join(repositoryPath, "repomix.config.json");
  generateRepomixConfigFile({
    profile,
    repositoryPath,
    outputPath: options.outputFile || path.join(outDir, "repo-context.xml"),
    templatePath: options.templatePath || DEFAULT_TEMPLATE_PATH,
    configPath,
  });
  const repomixResult = options.preferRepomix ? runRepomixOptional({
    repositoryPath,
    configPath,
    outputPath: path.join(outDir, "repo-context.xml"),
    repomixBinary: options.repomixBinary,
  }) : { used: false };
  const xmlPath = path.join(outDir, "repo-context.xml");
  const mdPath = path.join(outDir, "repo-summary.md");
  const tokenPath = path.join(outDir, "token-report.json");
  const xml = repomixResult.used
    ? fs.readFileSync(repomixResult.outputPath, "utf8")
    : generateRepoXml({ metadata, files });
  writeIfNeeded(xmlPath, xml);
  writeIfNeeded(mdPath, summarizeFiles(files, xmlPath, "Repository Context Summary"));
  const tokenReport = writeTokenReport(tokenPath, metadata, files, profileName, repomixResult.used);
  return {
    repositoryPath,
    profile: profileName,
    outDir,
    files,
    metadata,
    tokenReport,
    repomixUsed: repomixResult.used,
  };
}

function buildTaskContext(options) {
  const repositoryRoot = path.resolve(options.repositoryPath || process.cwd());
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profileName = options.profile || "coder";
  const profile = profiles[profileName];
  if (!profile) {
    throw new Error(`Unknown profile '${profileName}'.`);
  }
  const taskMap = parseTaskRecords(path.join(repositoryRoot, "global-issues.json"));
  const dependencyMap = parseDependencyMap(path.join(repositoryRoot, "dependency-map.json"));
  const nexus = loadNexusMetadata(repositoryRoot, options.taskId, null) || {};
  const wiki = loadWikiMetadata(repositoryRoot, options.taskId) || {};
  const seedId = String(options.taskId || "").toUpperCase();
  const relationships = [];
  const related = [];
  collectTaskClosure(seedId, taskMap, dependencyMap, options.dependencyDepth ?? 10, new Set(), relationships);
  for (const id of new Set([seedId, ...relationships.map((edge) => edge.to)])) {
    const task = taskMap.get(id);
    if (task) {
      related.push(task);
    }
  }
  const repoPaths = collectRepoPaths(related, repositoryRoot, path.join(repositoryRoot, "repo-registry.json"));
  const files = [];
  for (const repo of repoPaths) {
    const repoFiles = walkFiles(repo, profile);
    for (const file of repoFiles) {
      files.push({
        ...file,
        path: `${normalizeSegments(repositoryRoot, repo)}/${file.path}`,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const metadata = metadataEnvelope({
    profile: profileName,
    repositories: repoPaths.map((repo) => normalizeSegments(repositoryRoot, repo)),
    tasks: related.map((task) => task.id),
    dependencies: relationships,
    files,
  });
  const outDir = path.resolve(options.outputDir || path.join(repositoryRoot, "generated-context"));
  const xmlPath = path.join(outDir, "task-context.xml");
  const mdSummary = path.join(outDir, "task-summary.md");
  const mdDeps = path.join(outDir, "task-dependencies.md");
  writeIfNeeded(xmlPath, generateRepoXml({ metadata, files }));
  writeIfNeeded(mdSummary, summarizeFiles(files, xmlPath, `Task ${seedId} Summary`));
  const depLines = [`# Task Dependencies for ${seedId}`, "", ...relationships.map((edge) => `- ${edge.from} -> ${edge.to} (${edge.type})`)];
  if (relationships.length === 0) depLines.push("- no explicit dependencies");
  depLines.push("");
  depLines.push("## Nexus metadata");
  if (nexus && Array.isArray(nexus.relatedIssues)) {
    depLines.push(`Related issues: ${nexus.relatedIssues.join(", ")}`);
  }
  depLines.push("## Wiki metadata");
  if (wiki && Array.isArray(wiki.decisions)) {
    for (const row of wiki.decisions) {
      depLines.push(`- ${row.id || "decision"}: ${row.title || JSON.stringify(row)}`);
    }
  }
  writeIfNeeded(mdDeps, `${depLines.join("\n")}\n`);
  const tokenReport = {
    generated_at: metadata.generated_at,
    profile: profileName,
    repositories: metadata.repositories,
    tasks: metadata.tasks,
    dependencies: metadata.dependencies,
    estimated_tokens: metadata.estimated_tokens,
    file_count: metadata.file_count,
    repomix_used: false,
    files: files.map((f) => ({ path: f.path, size: f.size, tokens: f.tokens, sha1: f.sha1, kind: f.kind })),
  };
  writeIfNeeded(path.join(outDir, "token-report.json"), JSON.stringify(tokenReport, null, 2));
  return { outDir, xmlPath, mdSummary, mdDeps, metadata };
}

function buildPrContext(options) {
  const repositoryRoot = path.resolve(options.repositoryPath || process.cwd());
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[options.profile || "reviewer"] || profiles.reviewer;
  const prId = String(options.prNumber);
  const candidates = [
    path.join(repositoryRoot, "pr-data", `pr-${prId}.json`),
    path.join(repositoryRoot, "pull-requests.json"),
    path.join(repositoryRoot, "global-prs.json"),
  ];
  const prRecord = candidates.reduce((memo, file) => {
    const data = readJson(file);
    if (memo) return memo;
    if (!data) return memo;
    if (Array.isArray(data)) {
      return data.find((row) => String(row.number || row.id || "") === prId);
    }
    if (Array.isArray(data.prs)) {
      return data.prs.find((row) => String(row.number || row.id || "") === prId);
    }
    if (data.number === Number(prId)) return data;
    return memo;
  }, null);
  const changedFiles = Array.isArray(prRecord?.changedFiles) ? prRecord.changedFiles : [];
  const repos = Array.isArray(prRecord?.repositories) ? prRecord.repositories : ["."];
  const files = [];
  for (const repo of repos) {
    const absRepo = path.resolve(repositoryRoot, repo);
    const candidate = walkFiles(absRepo, profile).map((file) => {
      const shouldKeep = changedFiles.length === 0 || changedFiles.includes(file.path);
      if (!shouldKeep) {
        return null;
      }
      return {
        ...file,
        path: `${normalizeSegments(repositoryRoot, absRepo)}/${file.path}`,
      };
    }).filter(Boolean);
    files.push(...candidate);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const metadata = metadataEnvelope({
    profile: profile.name,
    repositories: repos,
    tasks: [],
    dependencies: [],
    files,
  });
  const nexus = loadNexusMetadata(repositoryRoot, null, prId) || {};
  const wiki = loadWikiMetadata(repositoryRoot) || {};
  const outDir = path.resolve(options.outputDir || path.join(repositoryRoot, "generated-context"));
  const xmlPath = path.join(outDir, "pr-context.xml");
  const relatedDecisionsPath = path.join(outDir, "related-decisions.md");
  const affectedReposPath = path.join(outDir, "affected-repositories.md");
  const mdSummary = path.join(outDir, "diff-summary.md");
  writeIfNeeded(xmlPath, generateRepoXml({ metadata, files }));
  const relations = (nexus?.prs?.find((row) => String(row.number || row.id || "") === prId) ?? null);
  const decisions = [];
  if (relations?.decisions && Array.isArray(relations.decisions)) {
    decisions.push(...relations.decisions);
  }
  if (Array.isArray(wiki?.decisions)) {
    for (const row of wiki.decisions) {
      if (!decisions.includes(row.id || row.title)) {
        decisions.push(row.id || row.title || "decision");
      }
    }
  }
  const decisionLines = ["# Related Decisions", ""];
  if (decisions.length === 0) {
    decisionLines.push("- no related decisions");
  } else {
    for (const decision of decisions) {
      decisionLines.push(`- ${decision}`);
    }
  }
  writeIfNeeded(relatedDecisionsPath, `${decisionLines.join("\n")}\n`);
  const repoLines = ["# Affected Repositories", ""];
  for (const repo of repos) {
    repoLines.push(`- ${repo}`);
  }
  writeIfNeeded(affectedReposPath, `${repoLines.join("\n")}\n`);
  writeIfNeeded(mdSummary, summarizeFiles(files, xmlPath, `PR-${prId} Diff Summary`));
  writeIfNeeded(path.join(outDir, "token-report.json"), JSON.stringify({
    generated_at: metadata.generated_at,
    profile: profile.name,
    repositories: metadata.repositories,
    tasks: metadata.tasks,
    dependencies: metadata.dependencies,
    estimated_tokens: metadata.estimated_tokens,
    file_count: metadata.file_count,
    repomix_used: false,
    files: files.map((f) => ({ path: f.path, size: f.size, tokens: f.tokens, sha1: f.sha1, kind: f.kind })),
  }, null, 2));
  return { outDir, xmlPath, mdSummary, relatedDecisionsPath, affectedReposPath, metadata };
}

function validateContextBudget(options) {
  const target = path.resolve(options.contextFile || path.join(options.repositoryPath || process.cwd(), "generated-context", "repo-context.xml"));
  const profileName = options.profile || "coder";
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[profileName] || profiles.coder;
  const reportPath = target.replace(/\.xml$/i, ".json").replace(/\.md$/i, ".json");
  const directReport = readJson(reportPath);
  const report = directReport || {
    profile: profileName,
    generated_at: new Date().toISOString(),
    repositories: [],
    tasks: [],
    dependencies: [],
    estimated_tokens: 0,
    files: [],
  };
  const files = Array.isArray(report.files) ? report.files : [];
  const failures = [];
  const byPath = new Map();
  const byChecksum = new Map();
  for (const file of files) {
    byPath.set(file.path, (byPath.get(file.path) || 0) + 1);
    if (typeof file.sha1 === "string") {
      byChecksum.set(file.sha1, [...(byChecksum.get(file.sha1) || []), file.path]);
    }
  }
  for (const [p, count] of byPath.entries()) {
    if (count > 1) {
      failures.push(`duplicate file path: ${p}`);
    }
  }
  for (const [hash, paths] of byChecksum.entries()) {
    if (hash && paths.length > 1) {
      failures.push(`duplicate file content: ${paths.join(", ")}`);
    }
  }
  for (const file of files) {
    if (file.kind === "doc" && file.tokens > profile.maxDocumentationFileTokens) {
      failures.push(`oversized documentation file: ${file.path}`);
    }
  }
  if (report.estimated_tokens > profile.tokenBudget) {
    failures.push(`token budget exceeded: ${report.estimated_tokens}/${profile.tokenBudget}`);
  }
  return { valid: failures.length === 0, failures, report, profile: profileName, targetFile: target };
}

function summarizeContext(options) {
  const xml = path.resolve(options.contextFile || path.join(options.repositoryPath || process.cwd(), "generated-context", "repo-context.xml"));
  const reportPath = xml.replace(/\.xml$/i, ".json").replace(/\.md$/i, ".json");
  const report = readJson(reportPath) || {
    generated_at: new Date().toISOString(),
    repositories: [],
    tasks: [],
    dependencies: [],
    files: [],
    estimated_tokens: 0,
    profile: "coder",
    include_decisions: [],
  };
  const outDir = path.dirname(xml);
  const summaryPath = path.join(outDir, "context-summary.md");
  const lines = [];
  lines.push("# Context Summary");
  lines.push("");
  lines.push(`Generated at: ${report.generated_at}`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Repositories: ${report.repositories.join(", ") || "unknown"}`);
  lines.push(`Files included: ${report.files.length}`);
  lines.push(`Files excluded: unknown`);
  lines.push(`Estimated tokens: ${report.estimated_tokens}`);
  lines.push("");
  lines.push("## Tasks");
  for (const t of report.tasks) {
    lines.push(`- ${t}`);
  }
  if (report.dependencies && report.dependencies.length > 0) {
    lines.push("");
    lines.push("## Dependencies");
    for (const d of report.dependencies) {
      lines.push(`- ${typeof d === "string" ? d : `${d.from || ""}->${d.to || ""}`}`);
    }
  }
  const out = `${lines.join("\n")}\n`;
  writeIfNeeded(summaryPath, out);
  return { summaryPath, report };
}

function generateRepomixConfigFile(options) {
  const profile = normalizeProfile(options.profile);
  const templateText = fs.readFileSync(options.templatePath || DEFAULT_TEMPLATE_PATH, "utf8");
  const rep = templateText
    .replaceAll("{{INCLUDE_PATTERNS}}", JSON.stringify(profile.includeDirectories))
    .replaceAll("{{EXCLUDE_PATTERNS}}", JSON.stringify(profile.excludeDirectories))
    .replaceAll("{{IGNORE_PATTERNS}}", JSON.stringify(profile.excludeDirectories))
    .replaceAll("{{OUTPUT_FILE}}", options.outputPath || path.join(options.repositoryPath || process.cwd(), "generated-context", "repo-context.xml"));
  fs.mkdirSync(path.dirname(options.configPath), { recursive: true });
  fs.writeFileSync(options.configPath, rep, "utf8");
  return options.configPath;
}

function generateRepomixConfig(options) {
  const profileName = options.profile || "coder";
  const profiles = loadProfiles(options.profilePath || DEFAULT_PROFILES_PATH);
  const profile = profiles[profileName] || profiles.coder;
  const repositoryPath = path.resolve(options.repositoryPath || process.cwd());
  const outputPath = path.join(repositoryPath, "repomix.config.json");
  const out = generateRepomixConfigFile({
    profile,
    repositoryPath,
    outputPath,
    templatePath: options.templatePath || DEFAULT_TEMPLATE_PATH,
    configPath: outputPath,
  });
  return { configPath: out };
}

module.exports = {
  loadProfiles,
  buildRepoContext,
  buildTaskContext,
  buildPrContext,
  validateContextBudget,
  summarizeContext,
  generateRepomixConfig,
  generateRepomixConfigFile,
  metadataEnvelope,
};
