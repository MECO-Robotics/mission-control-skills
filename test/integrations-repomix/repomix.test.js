const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(__filename);
const repomix = requireFromRepo("../../integrations/repomix/src/engine.js");
const graphify = requireFromRepo("../../integrations/graphify/src/engine.js");

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "repomix-"));
}

function cleanupDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test("loads all context profiles", () => {
  const profiles = repomix.loadProfiles();
  assert.ok(profiles.architect);
  assert.ok(profiles.coder);
  assert.ok(profiles.reviewer);
  assert.ok(profiles.maintainer);
});

test("builds repository context deterministically", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "src", "index.ts"), "export const value = 1;\n");
    write(path.join(repo, "README.md"), "# sample repo\n");
    write(path.join(repo, "AGENTS.md"), "# agents\n");
    const result = repomix.buildRepoContext({
      repositoryPath: repo,
      profile: "coder",
      outputDir: path.join(repo, "generated-context"),
      preferRepomix: false,
    });
    assert.equal(result.metadata.profile, "coder");
    assert.equal(result.repomixUsed, false);
    assert.equal(result.files.length >= 1, true);
  } finally {
    cleanupDir(root);
  }
});

test("builds task context with related tasks and dependencies", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "src", "task.ts"), "export const t = 1;\n");
    write(path.join(repo, "global-issues.json"), JSON.stringify({
      tasks: [
        { id: "MC-123", repository: "repo-a", files: ["src/task.ts"] },
        { id: "MC-456", repository: "repo-a", files: [] },
      ],
    }));
    write(path.join(repo, "dependency-map.json"), JSON.stringify({
      dependencies: [{ from: "MC-123", to: "MC-456", type: "depends_on" }],
    }));
    write(path.join(repo, "repo-registry.json"), JSON.stringify({
      repositories: { "repo-a": { path: "." } },
    }));
    const out = repomix.buildTaskContext({ repositoryPath: repo, taskId: "MC-123", outputDir: path.join(repo, "generated-context"), profile: "coder" });
    assert.ok(out.metadata.tasks.includes("MC-123"));
    assert.ok(out.metadata.dependencies.length >= 1);
    assert.equal(out.metadata.profile, "coder");
  } finally {
    cleanupDir(root);
  }
});

test("build-task-context can include graph context summaries", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "src", "task.ts"), "export const task = 1;\n");
    write(path.join(repo, "global-issues.json"), JSON.stringify({
      tasks: [{ id: "MC-500", repository: "repo-a", files: ["src/task.ts"] }],
    }));
    write(path.join(repo, "dependency-map.json"), JSON.stringify({ dependencies: [{ from: "MC-500", to: "MC-501", type: "depends_on" }] }));
    write(path.join(repo, "repo-registry.json"), JSON.stringify({ repositories: { "repo-a": { path: "." } } }));
    graphify.buildProjectGraph({
      repositoryRoot: repo,
      outputDir: path.join(repo, "generated-graphs"),
      profile: "coder",
      preferExternal: false,
    });
    const out = repomix.buildTaskContext({
      repositoryPath: repo,
      taskId: "MC-500",
      outputDir: path.join(repo, "generated-context"),
      profile: "coder",
    });
    assert.equal(out.graphContextPath !== null, true);
    const summary = fs.readFileSync(path.join(repo, "generated-context", "task-summary.md"), "utf8");
    assert.equal(summary.includes("Graph context"), true);
  } finally {
    cleanupDir(root);
  }
});

test("builds PR context with wiki-linked decisions", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "src", "feature.ts"), "export const feature = 5;\n");
    write(path.join(repo, "pr-data", "pr-77.json"), JSON.stringify({
      number: 77,
      changedFiles: ["src/feature.ts"],
      repositories: ["."],
      decisions: ["PR-DECISION-01"],
      relatedIssues: ["MC-200"],
    }));
    write(path.join(repo, "git-wiki.json"), JSON.stringify({
      decisions: [{ title: "PR-DECISION-01", id: "PR-DECISION-01" }],
    }));
    const out = repomix.buildPrContext({ repositoryPath: repo, prNumber: "77", outputDir: path.join(repo, "generated-context"), profile: "reviewer" });
    assert.ok(out.xmlPath);
    const decisions = fs.readFileSync(path.join(repo, "generated-context", "related-decisions.md"), "utf8");
    assert.equal(decisions.includes("PR-DECISION-01"), true);
  } finally {
    cleanupDir(root);
  }
});

test("build-pr-context includes graph neighborhoods for changed files", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "src", "feature.ts"), "export const feature = 5;\n");
    write(path.join(repo, "pr-data", "pr-77.json"), JSON.stringify({
      number: 77,
      changedFiles: ["src/feature.ts"],
      repositories: ["."],
      decisions: ["PR-DECISION-01"],
      relatedIssues: ["MC-200"],
    }));
    write(path.join(repo, "global-issues.json"), JSON.stringify({
      tasks: [{ id: "MC-200", repository: "repo-a", files: ["src/feature.ts"] }],
    }));
    write(path.join(repo, "dependency-map.json"), JSON.stringify({ dependencies: [] }));
    write(path.join(repo, "repo-registry.json"), JSON.stringify({ repositories: { "repo-a": { path: "." } } }));
    write(path.join(repo, "git-nexus.json"), JSON.stringify({
      tasks: [{ id: "MC-200", relatedPrs: [77], relatedIssues: ["ISS-1"] }],
    }));
    graphify.buildProjectGraph({
      repositoryRoot: repo,
      outputDir: path.join(repo, "generated-graphs"),
      profile: "reviewer",
      preferExternal: false,
    });
    const out = repomix.buildPrContext({
      repositoryPath: repo,
      prNumber: "77",
      outputDir: path.join(repo, "generated-context"),
      profile: "reviewer",
    });
    assert.equal(typeof out.outDir, "string");
    const summary = fs.readFileSync(path.join(repo, "generated-context", "diff-summary.md"), "utf8");
    assert.equal(summary.includes("Graph neighborhoods"), true);
  } finally {
    cleanupDir(root);
  }
});

test("validates repository context budget limits", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "README.md"), "A".repeat(20000));
    const result = repomix.buildRepoContext({
      repositoryPath: repo,
      profile: "coder",
      outputDir: path.join(repo, "generated-context"),
      preferRepomix: false,
    });
    const tokenReport = path.join(repo, "generated-context", "token-report.json");
    const original = JSON.parse(fs.readFileSync(tokenReport, "utf8"));
    original.estimated_tokens = 999999;
    write(tokenReport, JSON.stringify(original));
    const validation = repomix.validateContextBudget({
      contextFile: path.join(repo, "generated-context", "repo-context.xml"),
      profile: "coder",
      repositoryPath: repo,
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.failures.some((f) => f.includes("token budget")), true);
  } finally {
    cleanupDir(root);
  }
});

test("integrates Git Nexus and Git Wiki metadata in task context", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "global-issues.json"), JSON.stringify({
      tasks: [{ id: "MC-900", repository: "repo-a", files: [] }],
    }));
    write(path.join(repo, "dependency-map.json"), JSON.stringify({ dependencies: [] }));
    write(path.join(repo, "repo-registry.json"), JSON.stringify({ repositories: { "repo-a": { path: "." } } }));
    write(path.join(repo, "git-nexus.json"), JSON.stringify({
      tasks: [{ id: "MC-900", relatedIssues: ["ISS-1"], relatedBranches: ["main"], relatedPrs: [11], dependencyChains: [["MC-900", "MC-901"]] }],
    }));
    write(path.join(repo, "git-wiki.json"), JSON.stringify({
      decisions: [{ taskId: "MC-900", id: "DEC-001", title: "architecture decision" }],
    }));
    write(path.join(repo, "src", "index.ts"), "export const x = 2;\n");
    const out = repomix.buildTaskContext({
      repositoryPath: repo,
      taskId: "MC-900",
      outputDir: path.join(repo, "generated-context"),
      profile: "coder",
    });
    const taskDeps = fs.readFileSync(path.join(repo, "generated-context", "task-dependencies.md"), "utf8");
    assert.equal(taskDeps.includes("DEC-001") || taskDeps.includes("related"), true);
    assert.ok(out.xmlPath);
  } finally {
    cleanupDir(root);
  }
});

test("falls back when repomix binary is unavailable", () => {
  const root = tempDir();
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo, { recursive: true });
    write(path.join(repo, "README.md"), "fallback test\n");
    const result = repomix.buildRepoContext({
      repositoryPath: repo,
      profile: "coder",
      outputDir: path.join(repo, "generated-context"),
      preferRepomix: true,
      repomixBinary: "nonexistent-repomix-binary",
    });
    assert.equal(result.repomixUsed, false);
  } finally {
    cleanupDir(root);
  }
});
