const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { test } = require("node:test");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(__filename);
const graphify = requireFromRepo("../../integrations/graphify/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "graphify-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function buildWorkspace() {
  const root = tempDir();
  const outGraphs = path.join(root, "generated-graphs");
  const outContext = path.join(root, "generated-context");
  write(path.join(root, "repo-registry.json"), JSON.stringify({
    repositories: {
      "repo-a": { path: ".", owner: "platform-team" },
    },
  }));
  write(path.join(root, "global-issues.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-123",
        title: "Add authentication middleware",
        description: "Track task for auth middleware work.",
        repository: "repo-a",
        files: ["src/auth.ts"],
      },
      {
        id: "MC-456",
        title: "Build auth tests",
        description: "Testing task.",
        repository: "repo-a",
        files: ["test/auth.test.ts"],
      },
    ],
  }));
  write(path.join(root, "dependency-map.json"), JSON.stringify({
    dependencies: [{ from: "MC-123", to: "MC-456", type: "depends_on", repository: "repo-a" }],
  }));
  write(path.join(root, "decision-log.json"), JSON.stringify({
    decisions: [{ id: "DEC-1", title: "Auth strategy", taskId: "MC-123", text: "Use shared middleware approach." }],
  }));
  write(path.join(root, "git-wiki.json"), JSON.stringify({
    pages: [{ id: "wiki-auth", title: "Auth wiki", path: "wiki/auth.md", content: "Shared middleware and ownership guidance." }],
    decisions: [{ id: "WDEC-1", taskId: "MC-456", title: "Task decision", text: "Add middleware boundary tests." }],
  }));
  write(path.join(root, "architecture-wiki.md"), "# Architecture\\nCentral auth layer design.");
  write(path.join(root, "src", "auth.ts"), "export function authenticationMiddleware(req, next) { return next(); }");
  write(path.join(root, "test", "auth.test.ts"), "export const test = \"ok\";");
  write(path.join(root, "analysis-results", "findings.json"), JSON.stringify({
    findings: [
      {
        id: "F-1001",
        source: "semgrep",
        repository: ".",
        file: "src/auth.ts",
        line: 1,
        severity: "high",
        category: "security",
        rule: "auth-eval",
        message: "Avoid dynamic execution.",
        recommendation: "Use parser helper.",
      },
    ],
  }));

  return { root, outGraphs, outContext };
}

test("loads all graph profiles", () => {
  const profiles = graphify.loadProfiles();
  assert.ok(profiles.architect);
  assert.ok(profiles.coder);
  assert.ok(profiles.reviewer);
  assert.ok(profiles.maintainer);
});

test("build-project-graph generates local fallback graph", () => {
  const { root, outGraphs } = buildWorkspace();
  try {
    const result = graphify.buildProjectGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      preferExternal: false,
      profile: "coder",
    });
    const graph = JSON.parse(fs.readFileSync(result.graphPath, "utf8"));
    assert.equal(result.external, false);
    assert.equal(graph.nodes.length > 0, true);
    assert.equal(graph.edges.length > 0, true);
    assert.equal(graph.nodes.some((row) => row.node_type === "task"), true);
    assert.equal(graph.nodes.some((row) => row.node_type === "dependency"), true);
  } finally {
    cleanup(root);
  }
});

test("build-task-graph extracts neighborhood for MC-123", () => {
  const { root, outGraphs } = buildWorkspace();
  try {
    const result = graphify.buildTaskGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      taskId: "MC-123",
      profile: "coder",
    });
    const taskGraph = JSON.parse(fs.readFileSync(result.graphPath, "utf8"));
    assert.equal(result.taskId, "MC-123");
    assert.equal(taskGraph.nodes.some((row) => row.task_id === "MC-123"), true);
    assert.equal(taskGraph.nodes.some((row) => row.node_type === "task" && row.task_id === "MC-456"), true);
    assert.equal(fs.existsSync(result.summaryPath), true);
    const summary = fs.readFileSync(result.summaryPath, "utf8");
    assert.equal(summary.includes("Task Graph Summary"), true);
  } finally {
    cleanup(root);
  }
});

test("query-project-graph returns ranked matches", () => {
  const { root, outGraphs } = buildWorkspace();
  try {
    graphify.buildProjectGraph({ repositoryRoot: root, outputDir: outGraphs, preferExternal: false, profile: "coder" });
    const result = graphify.queryProjectGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      profile: "coder",
      query: "authentication",
      limit: 10,
    });
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length > 0, true);
    assert.equal(result.results[0].score >= 0, true);
  } finally {
    cleanup(root);
  }
});

test("graph includes finding nodes and finding edges from static-analysis payload", () => {
  const { root, outGraphs } = buildWorkspace();
  try {
    const result = graphify.buildProjectGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      preferExternal: false,
      profile: "reviewer",
    });
    const graph = JSON.parse(fs.readFileSync(result.graphPath, "utf8"));
    assert.equal(graph.nodes.some((row) => row.node_type === "finding"), true);
    const findQuery = graphify.queryProjectGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      profile: "reviewer",
      query: "auth-eval",
      limit: 10,
    });
    assert.equal(Array.isArray(findQuery.results), true);
    assert.equal(findQuery.results.some((row) => row.node_type === "finding"), true);
  } finally {
    cleanup(root);
  }
});

test("export-graph-context creates summary files", () => {
  const { root, outGraphs, outContext } = buildWorkspace();
  try {
    graphify.buildProjectGraph({ repositoryRoot: root, outputDir: outGraphs, preferExternal: false, profile: "coder" });
    const result = graphify.exportGraphContext({
      repositoryRoot: root,
      outputDir: outContext,
      graphPath: path.join(outGraphs, "project-graph.json"),
      profile: "coder",
      taskId: "MC-123",
    });
    assert.equal(fs.existsSync(result.graphContextJsonPath), true);
    assert.equal(fs.existsSync(result.graphContextMdPath), true);
    const md = fs.readFileSync(result.graphContextMdPath, "utf8");
    assert.equal(md.includes("Graph Context"), true);
  } finally {
    cleanup(root);
  }
});

test("summarize-graph validates graph structure", () => {
  const { root, outGraphs } = buildWorkspace();
  try {
    graphify.buildProjectGraph({ repositoryRoot: root, outputDir: outGraphs, preferExternal: false, profile: "reviewer" });
    const validation = graphify.validateGraph({
      repositoryRoot: root,
      outputDir: outGraphs,
      graphFile: "project-graph.json",
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.failures.length, 0);
  } finally {
    cleanup(root);
  }
});
