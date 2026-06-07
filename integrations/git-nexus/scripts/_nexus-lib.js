const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const MISSION_CONTROL_DIR = path.join(ROOT, ".mission-control");

const NODE_TYPES = new Set([
  "repository",
  "task",
  "issue",
  "branch",
  "commit",
  "pull_request",
  "review",
  "merge",
]);

const EDGE_TYPES = new Set([
  "belongs_to",
  "implements",
  "contains",
  "reviews",
  "merges",
  "depends_on",
  "blocks",
  "modifies",
  "supersedes",
]);

const MC_TASK_STATUSES = new Set([
  "planned",
  "queued",
  "in_progress",
  "blocked",
  "review",
  "merged",
  "completed",
  "cancelled",
]);

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

function absolutePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

function readJSON(filePath, label = "json") {
  const full = absolutePath(filePath);
  if (!fs.existsSync(full)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  const raw = fs.readFileSync(full, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid ${label}: ${error.message}`);
  }
}

function writeJSON(data, outputPath) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  if (outputPath) {
    const output = absolutePath(outputPath);
    fs.writeFileSync(output, payload, "utf8");
    console.log(`wrote ${path.relative(ROOT, output)}`);
    return;
  }
  process.stdout.write(payload);
}

function toLookup(values = []) {
  const set = new Set();
  for (const item of values) set.add(item);
  return set;
}

function loadRepoRegistry() {
  const filePath = path.join(MISSION_CONTROL_DIR, "repo-registry.json");
  const data = readJSON(filePath, "repo registry");
  const repos = Array.isArray(data.repos) ? data.repos : [];
  const names = repos
    .map((repo) => (repo && typeof repo.name === "string" ? repo.name.trim() : ""))
    .filter(Boolean);
  return { path: filePath, data, names: toLookup(names) };
}

function loadIssuesFile() {
  const filePath = path.join(MISSION_CONTROL_DIR, "global-issues.json");
  const data = readJSON(filePath, "global issues");
  return { path: filePath, data: data && Array.isArray(data.tasks) ? data : { tasks: [] } };
}

function loadDependencyMapFile() {
  const filePath = path.join(MISSION_CONTROL_DIR, "dependency-map.json");
  const data = readJSON(filePath, "dependency map");
  return {
    path: filePath,
    data: data && Array.isArray(data.dependencies) ? data : { dependencies: [] },
  };
}

function loadDecisionLog() {
  const filePath = path.join(MISSION_CONTROL_DIR, "cross-repo-decisions.md");
  return { path: filePath };
}

function validateGraphShape(graph) {
  const errors = [];
  const warnings = [];

  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    errors.push("graph must be an object with nodes and edges");
    return { errors, warnings, nodeIds: new Set(), validEdges: [] };
  }
  if (!Array.isArray(graph.nodes)) {
    errors.push("nodes must be an array");
    return { errors, warnings, nodeIds: new Set(), validEdges: [] };
  }
  if (!Array.isArray(graph.edges)) {
    errors.push("edges must be an array");
    return { errors, warnings, nodeIds: new Set(), validEdges: [] };
  }

  const nodeIds = new Set();
  graph.nodes.forEach((node, index) => {
    if (!node || typeof node !== "object") {
      warnings.push(`node[${index}] is not an object`);
      return;
    }
    if (typeof node.id !== "string" || !node.id.trim()) {
      warnings.push(`node[${index}] missing valid id`);
      return;
    }
    if (!NODE_TYPES.has(node.type)) {
      errors.push(`node ${node.id} has invalid type: ${node.type}`);
      return;
    }
    if (typeof node.repo !== "string") {
      errors.push(`node ${node.id} missing string repo`);
    }
    if (typeof node.external_id !== "string") {
      errors.push(`node ${node.id} missing string external_id`);
    }
    if (typeof node.title !== "string") {
      errors.push(`node ${node.id} missing string title`);
    }
    if (typeof node.status !== "string") {
      errors.push(`node ${node.id} missing string status`);
    }
    if (node.metadata !== undefined && (node.metadata === null || typeof node.metadata !== "object" || Array.isArray(node.metadata))) {
      errors.push(`node ${node.id} metadata must be an object when present`);
    }
    nodeIds.add(node.id);
  });

  const edgeWarnings = [];
  const validEdges = [];
  graph.edges.forEach((edge, index) => {
    if (!edge || typeof edge !== "object") {
      edgeWarnings.push(`edge[${index}] is not an object`);
      return;
    }
    if (typeof edge.source !== "string" || !edge.source.trim()) {
      edgeWarnings.push(`edge[${index}] missing valid source`);
      return;
    }
    if (typeof edge.target !== "string" || !edge.target.trim()) {
      edgeWarnings.push(`edge[${index}] missing valid target`);
      return;
    }
    if (!EDGE_TYPES.has(edge.type)) {
      errors.push(`edge ${edge.source}->${edge.target} has invalid type: ${edge.type}`);
      return;
    }
    if (edge.metadata !== undefined && (edge.metadata === null || typeof edge.metadata !== "object" || Array.isArray(edge.metadata))) {
      errors.push(`edge ${edge.source}->${edge.target} metadata must be an object when present`);
      return;
    }
    validEdges.push(edge);
  });

  return { errors, warnings: warnings.concat(edgeWarnings), nodeIds, validEdges };
}

function validateGraph(graph, opts = {}) {
  const { knownRepos = new Set(), checkUnknownRepos = true } = opts;
  const result = validateGraphShape(graph);
  const { errors, warnings, nodeIds, validEdges } = result;
  const unresolvedTargets = [];

  validEdges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) {
      errors.push(`edge source does not exist: ${edge.source}`);
      return;
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`edge target does not exist: ${edge.target}`);
      return;
    }
  });

  if (checkUnknownRepos) {
    graph.nodes.forEach((node) => {
      if (node && node.repo && !knownRepos.has(node.repo) && node.type !== "repository") {
        errors.push(`unknown repository in node ${node.id}: ${node.repo}`);
      }
      if (node && node.type === "repository" && node.id && !knownRepos.has(node.repo)) {
        warnings.push(`repository node ${node.id} references unregistered repo: ${node.repo}`);
      }
    });
  }

  validEdges.forEach((edge) => {
    const sourceExists = graph.nodes.find((n) => n.id === edge.source);
    const targetExists = graph.nodes.find((n) => n.id === edge.target);
    if (sourceExists && targetExists) {
      if (checkUnknownRepos && sourceExists.repo && !knownRepos.has(sourceExists.repo) && sourceExists.type !== "repository") {
        warnings.push(`edge source repo not in registry: ${sourceExists.repo}`);
      }
      if (checkUnknownRepos && targetExists.repo && !knownRepos.has(targetExists.repo) && targetExists.type !== "repository") {
        warnings.push(`edge target repo not in registry: ${targetExists.repo}`);
      }
    }
  });

  // Keep edge shape check but only include structurally valid entries.
  return {
    errors,
    warnings: [...new Set(warnings)],
    validEdges,
    valid: errors.length === 0,
  };
}

function cloneMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function dedupeNodes(nodes) {
  const output = [];
  const seen = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || typeof node.id !== "string") continue;
    if (!seen.has(node.id)) {
      output.push({ ...node, metadata: cloneMetadata(node.metadata) });
      seen.set(node.id, output.length - 1);
      continue;
    }
    const existing = output[seen.get(node.id)];
    output[seen.get(node.id)] = {
      ...existing,
      ...node,
      metadata: { ...cloneMetadata(existing.metadata), ...cloneMetadata(node.metadata) },
    };
  }
  return output;
}

function normalizeGraph(graph) {
  const dedupedNodes = dedupeNodes(graph.nodes || []);
  const nodeIds = new Set(dedupedNodes.map((node) => node.id));
  const seenEdges = new Set();
  const dedupedEdges = [];
  const dangling = [];

  for (const edge of graph.edges || []) {
    if (!edge || typeof edge !== "object") continue;
    const key = `${edge.source}|${edge.type}|${edge.target}`;
    if (!edge.source || !edge.target) {
      continue;
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      dangling.push(edge);
      continue;
    }
    if (seenEdges.has(key)) continue;
    dedupedEdges.push({ ...edge, metadata: cloneMetadata(edge.metadata) });
    seenEdges.add(key);
  }

  const nodes = dedupedNodes
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = dedupedEdges
    .slice()
    .sort((a, b) =>
      a.source.localeCompare(b.source) ||
      a.type.localeCompare(b.type) ||
      a.target.localeCompare(b.target)
    );

  return { nodes, edges, dangling };
}

function stableSortedArray(values) {
  return values
    .slice()
    .sort((a, b) => a.localeCompare(b));
}

function uniqueArray(values = []) {
  return Array.from(new Set(values));
}

function getNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
  }
  return null;
}

function parseStatusForTask(status) {
  return MC_TASK_STATUSES.has(status) ? status : "planned";
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

module.exports = {
  EDGE_TYPES,
  NODE_TYPES,
  MC_TASK_STATUSES,
  MISSION_CONTROL_DIR,
  absolutePath,
  cloneMetadata,
  dedupeNodes,
  getNodeById,
  loadDecisionLog,
  loadDependencyMapFile,
  loadIssuesFile,
  loadRepoRegistry,
  normalizeGraph,
  parseArgs,
  parseStatusForTask,
  readJSON,
  readText,
  stableSortedArray,
  uniqueArray,
  validateGraph,
  writeJSON,
  writeText: (value, outputPath) => {
    if (outputPath) {
      fs.writeFileSync(absolutePath(outputPath), value, "utf8");
      return;
    }
    process.stdout.write(value);
  },
};
