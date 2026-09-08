const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require("node:fs");

const semantic = require("../../integrations/semantic-retrieval/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mission-semantic-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function buildFixtureWorkspace() {
  const root = tempDir();
  write(path.join(root, "repo-registry.json"), JSON.stringify({
    repositories: {
      "repo-a": { path: "." },
    },
  }));
  write(path.join(root, "global-issues.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-901",
        title: "authentication hardening",
        description: "Improve authentication middleware and error handling.",
        repository: "repo-a",
        files: ["src/auth.ts"],
      },
    ],
  }));
  write(path.join(root, "dependency-map.json"), JSON.stringify({
    dependencies: [
      { from: "MC-901", to: "MC-902", type: "depends_on", repository: "." },
    ],
  }));
  write(path.join(root, "decision-log.json"), JSON.stringify({
    decisions: [
      { id: "DEC-9", title: "Auth boundary", taskId: "MC-901", text: "Require explicit middleware for every auth boundary." },
    ],
  }));
  write(path.join(root, "architecture-wiki.md"), "# architecture\nCentralized auth middleware and token validation.\n");
  write(path.join(root, "git-wiki.json"), JSON.stringify({ pages: [{ id: "wiki-auth", title: "Auth docs", path: "auth.md", content: "Uses token checks and claims validation." }] }));
  write(path.join(root, "analysis-results", "findings.json"), JSON.stringify({
    findings: [
      {
        id: "F-1",
        source: "semgrep",
        repository: ".",
        file: "src/auth.ts",
        line: 3,
        severity: "high",
        category: "security",
        rule: "no-raw-header",
        message: "Avoid forwarding raw auth header.",
        recommendation: "Validate header source carefully.",
      },
    ],
  }));
  write(path.join(root, "analysis-results", "review-findings.json"), JSON.stringify({
    findings: [
      { id: "RF-1", source: "manual", repository: ".", file: "src/auth.ts", line: 4, rule: "rf-001", severity: "medium", category: "logic", message: "Consider fallback path", recommendation: "Add safe fallback." },
    ],
  }));
  write(path.join(root, "analysis-results", "review-summary.md"), "# review\n- found auth risk\n");
  write(path.join(root, "generated-graphs", "project-graph-summary.md"), "# graph\nNo cycles.\n");
  write(path.join(root, "generated-graphs", "project-graph.json"), JSON.stringify({ nodes: [{ id: "n1", type: "module" }, { id: "n2", type: "task" }], edges: [{ from: "n1", to: "n2", edge_type: "depends_on" }] }));
  write(path.join(root, "src", "auth.ts"), `export function authenticationMiddleware(req: any) {\n  const token = req?.headers?.authorization;\n  return token;\n}\n`);

  return { root };
}

function indexWorkspace(root) {
  return semantic.buildSemanticIndex({
    repositoryRoot: root,
    outputDir: path.join(root, "generated-semantic-index"),
    profile: "coder",
  });
}

test("loads semantic profiles", () => {
  const profiles = semantic.loadProfiles();
  assert.ok(profiles.architect);
  assert.ok(profiles.coder);
  assert.ok(profiles.reviewer);
  assert.ok(profiles.maintainer);
});

test("redacts secrets before embedding", () => {
  const input = "api_key=ABCD1234_abc-DEF and password: hunter2";
  const masked = semantic.redactSecrets(input);
  assert.equal(/\[redacted\]/.test(masked), true);
});

test("build-semantic-index creates local deterministic index", () => {
  const { root } = buildFixtureWorkspace();
  try {
    const result = indexWorkspace(root);
    const payload = JSON.parse(fs.readFileSync(result.indexPath, "utf8"));
    assert.equal(payload.vector_enabled, false);
    assert.equal(payload.count > 0, true);
    assert.equal(payload.source_types.includes("code_symbols"), true);
    assert.equal(payload.source_types.includes("graph_summaries"), true);
  } finally {
    cleanup(root);
  }
});

test("semantic-search returns normalized results", () => {
  const { root } = buildFixtureWorkspace();
  try {
    indexWorkspace(root);
    const result = semantic.semanticSearch({
      query: "authentication middleware",
      profile: "coder",
      repositoryRoot: root,
      indexRoot: path.join(root, "generated-semantic-index"),
      limit: 8,
    });
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length > 0, true);
    const row = result.results[0];
    assert.equal(typeof row.id, "string");
    assert.equal(["code_symbols", "docs", "decisions", "findings", "tasks"].includes(row.source_type), true);
    assert.equal(row.source, "semantic-retrieval");
  } finally {
    cleanup(root);
  }
});

test("hybrid search includes code-search signal for symbol queries", () => {
  const { root } = buildFixtureWorkspace();
  try {
    indexWorkspace(root);
    const result = semantic.hybridSemanticSearch({
      query: "authenticationMiddleware",
      profile: "coder",
      repositoryRoot: root,
      indexRoot: path.join(root, "generated-semantic-index"),
      limit: 10,
    });
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length > 0, true);
    const hasExactSymbol = result.results.some((row) => row.source === "code-search");
    assert.equal(hasExactSymbol, true);
  } finally {
    cleanup(root);
  }
});

test("update-semantic-index short-circuits unchanged state", () => {
  const { root } = buildFixtureWorkspace();
  try {
    const first = indexWorkspace(root);
    const second = semantic.updateSemanticIndex({ repositoryRoot: root, outputDir: path.join(root, "generated-semantic-index") });
    assert.equal(second.unchanged, true);
    assert.equal(first.recordCount, second.recordCount);

    write(path.join(root, "src", "new.ts"), "export const x = 1;\n");
    const third = semantic.updateSemanticIndex({ repositoryRoot: root, outputDir: path.join(root, "generated-semantic-index") });
    assert.equal(third.unchanged, false);
    assert.equal(third.recordCount > second.recordCount, true);
  } finally {
    cleanup(root);
  }
});

test("compare-retrieval-modes writes comparison artifacts", () => {
  const { root } = buildFixtureWorkspace();
  try {
    indexWorkspace(root);
    const result = semantic.compareRetrievalModes({
      query: "auth",
      profile: "coder",
      repositoryRoot: root,
      indexRoot: path.join(root, "generated-semantic-index"),
      outputDir: path.join(root, "generated-context"),
      limit: 8,
    });
    assert.equal(typeof result.mdPath, "string");
    assert.equal(typeof result.jsonPath, "string");
    assert.equal(fs.existsSync(result.mdPath), true);
    assert.equal(fs.existsSync(result.jsonPath), true);
    const payload = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));
    assert.equal(payload.query, "auth");
    assert.equal(["code", "semantic", "graph", "hybrid"].every((k) => Object.prototype.hasOwnProperty.call(payload.counts, k)), true);
  } finally {
    cleanup(root);
  }
});
