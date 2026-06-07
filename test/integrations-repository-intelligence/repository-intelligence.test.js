const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require("node:fs");
const { test } = require("node:test");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(__filename);
const intelligence = requireFromRepo("../../integrations/repository-intelligence/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mission-intel-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function buildFixtureWorkspace() {
  const root = tempDir();
  const indexRoot = path.join(root, ".index");
  write(path.join(root, "repo-registry.json"), JSON.stringify({
    repositories: {
      "repo-a": { path: "repo-a", owner: "platform-team" },
      "repo-b": { path: "repo-b", owner: "platform-team" },
    },
  }));
  write(path.join(root, "global-issues.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-101",
        title: "auth middleware standardization",
        description: "Standardize authentication middleware across services.",
        repository: "repo-a",
        files: ["src/auth.ts"],
        tags: ["auth"],
      },
      {
        id: "MC-102",
        title: "review auth metrics",
        description: "Create task for metrics in auth layer.",
        repository: "repo-b",
        files: ["services/metrics.ts"],
      },
    ],
  }));
  write(path.join(root, "dependency-map.json"), JSON.stringify({
    dependencies: [{ from: "MC-101", to: "MC-102", type: "depends_on" }],
  }));
  write(path.join(root, "architecture-wiki.md"), "# Architecture\\nAuth flows are gateway based.");
  write(path.join(root, "decision-log.json"), JSON.stringify({
    decisions: [
      { id: "DEC-1", title: "Authentication boundary", taskId: "MC-101", text: "Use middleware for all auth entry points." },
    ],
  }));
  write(path.join(root, "git-wiki.json"), JSON.stringify({
    pages: [{ id: "wiki-auth", title: "Auth policy", path: "auth.md", content: "Centralized middleware policy and ownership." }],
  }));
  write(path.join(root, "repo-a", "src", "auth.ts"), `
export function authenticationMiddleware(req, res, next) {
  if (!req.user) throw new Error(\"auth required\");
  next();
}
`);
  write(path.join(root, "repo-a", "src", "token.ts"), "export const token = \"abc\";");
  write(path.join(root, "repo-b", "src", "metrics.ts"), "export const collectAuthMetrics = () => {};");
  write(path.join(root, "git-nexus.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-101",
        relatedBranches: ["main"],
        relatedPrs: [11],
        relatedIssues: ["ISS-1"],
        dependencyChains: [["MC-101", "MC-102"]],
      },
    ],
    prs: [
      { number: 11, relatedTasks: ["MC-101"], changedFiles: ["repo-a/src/auth.ts"], decisions: ["DEC-1"] },
    ],
  }));

  return { root, indexRoot };
}

test("build-index creates search domains", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    const result = intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    assert.equal(result.codeIndexPath && result.codeIndexPath.endsWith("code/index.json"), true);
    assert.equal(result.docsIndexPath.endsWith("docs/index.json"), true);
    assert.equal(result.tasksIndexPath.endsWith("tasks/index.json"), true);
    assert.equal(result.dependenciesIndexPath.endsWith("dependencies/index.json"), true);
    const valid = intelligence.validateIndex({ repositoryRoot: root, indexRoot });
    assert.equal(valid.valid, true);
  } finally {
    cleanup(root);
  }
});

test("semantic-search finds similar implementations", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    const result = intelligence.semanticSearch({ query: "authentication middleware", repositoryRoot: root, indexRoot });
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length > 0, true);
    assert.equal(result.mode, "keyword-fallback");
    assert.equal(result.results[0].symbol.includes("MC-101") || result.results[0].file.includes("auth.ts"), true);
  } finally {
    cleanup(root);
  }
});

test("symbol-search returns exact location and related symbols", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    const result = intelligence.symbolSearch({ symbolName: "authenticationMiddleware", repositoryRoot: root, indexRoot, limit: 10 });
    assert.equal(result.results.length > 0, true);
    const hit = result.results[0];
    assert.equal(hit.symbol, "authenticationMiddleware");
    assert.equal(typeof hit.references[0], "string");
    assert.equal(hit.relatedSymbols.length >= 0, true);
  } finally {
    cleanup(root);
  }
});

test("hybrid-search ranks task + dependency + semantic evidence", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "reviewer" });
    const result = intelligence.hybridSearch({ query: "MC-101", profile: "reviewer", repositoryRoot: root, indexRoot, limit: 20 });
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length > 0, true);
    assert.equal(result.profile, "reviewer");
    assert.equal(result.results[0].ranking.taskRelevance >= 0, true);
  } finally {
    cleanup(root);
  }
});

test("task-search identifies related tasks", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    const result = intelligence.taskSearch({ query: "MC-101", repositoryRoot: root, indexRoot });
    assert.equal(result.results.length >= 1, true);
    assert.equal(result.results[0].taskId, "MC-101");
    assert.equal(result.results[0].files.includes("src/auth.ts"), true);
  } finally {
    cleanup(root);
  }
});

test("dependency-search follows dependency edges", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "maintainer" });
    const result = intelligence.dependencySearch({ query: "MC-101", repositoryRoot: root, indexRoot });
    assert.equal(result.results.length >= 1, true);
    assert.equal(result.results[0].to, "MC-102");
    assert.equal(result.results[0].type, "depends_on");
  } finally {
    cleanup(root);
  }
});

test("find_context helpers are available for codex workflows", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    const taskContext = intelligence.find_context_for_task({
      repositoryRoot: root,
      taskId: "MC-101",
      profile: "coder",
      limit: 20,
    });
    assert.equal(Array.isArray(taskContext.files), true);
    assert.equal(taskContext.files.length > 0, true);
    assert.equal(Array.isArray(taskContext.dependencies), true);
    assert.equal(Array.isArray(taskContext.documentation), true);
    assert.equal(taskContext.taskId, "MC-101");
  } finally {
    cleanup(root);
  }
});

test("fallback to keyword search when embeddings disabled", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "coder" });
    const result = intelligence.semanticSearch({ query: "middleware", repositoryRoot: root, indexRoot, preferVector: true });
    assert.equal(result.mode, "keyword-fallback");
  } finally {
    cleanup(root);
  }
});

test("ranking is deterministic and sorted by relevance", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    intelligence.buildIndexes({ repositoryRoot: root, indexRoot, profile: "reviewer" });
    const first = intelligence.hybridSearch({ query: "MC-101", repositoryRoot: root, indexRoot, profile: "reviewer", limit: 10 });
    const second = intelligence.hybridSearch({ query: "MC-101", repositoryRoot: root, indexRoot, profile: "reviewer", limit: 10 });
    const keys1 = first.results.map((row) => `${row.repository}|${row.file}|${row.score}`);
    const keys2 = second.results.map((row) => `${row.repository}|${row.file}|${row.score}`);
    assert.deepEqual(keys1, keys2);
  } finally {
    cleanup(root);
  }
});
