const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { test } = require("node:test");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(__filename);
const staticAnalysis = requireFromRepo("../../integrations/static-analysis/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mc-static-analysis-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function writeRepositoryWorkspace() {
  const root = tempDir();
  const src = path.join(root, "repo");
  mkdirSync(src, { recursive: true });
  write(path.join(src, "src", "auth.ts"), "export const auth = () => eval(\"x\");");
  write(path.join(src, "global-issues.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-100",
        title: "Harden authentication",
        repository: ".",
        files: ["src/auth.ts"],
      },
    ],
  }));
  return { root, src };
}

test("loads analyzer config profiles", () => {
  const config = staticAnalysis.loadConfig();
  assert.equal(Boolean(config.profiles?.architect), true);
  assert.equal(Boolean(config.profiles?.reviewer), true);
});

test("parse-analysis-results normalizes semgrep JSON", () => {
  const root = tempDir();
  try {
    const rawOutput = {
      results: [
        {
          check_id: "eval-unsafe",
          path: "src/auth.ts",
          start: { line: 9 },
          message: "Avoid eval.",
          extra: { severity: "warning", metadata: { category: "security", confidence: "high" } },
        },
      ],
  };
    const outputPath = path.join(root, "semgrep.json");
    write(outputPath, JSON.stringify(rawOutput));
    const parsed = staticAnalysis.parseAnalysisResults({ inputPath: outputPath, analyzer: "semgrep" });
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0].severity, "high");
    assert.equal(parsed.findings[0].source, "semgrep");
  } finally {
    cleanup(root);
  }
});

test("run-analysis tolerates missing semgrep binary and records analyzer failure", () => {
  const { root, src } = writeRepositoryWorkspace();
  try {
    const result = staticAnalysis.runAnalysis({
      repositoryRoot: src,
      profile: "coder",
      resultDir: "analysis-results",
    });
    assert.equal(result.findingCount, 0);
    assert.equal(result.analyzerFailures.length >= 1, true);
  } finally {
    cleanup(root);
  }
});

test("task context generation identifies task-related static findings", () => {
  const { root, src } = writeRepositoryWorkspace();
  try {
    write(path.join(src, "analysis-results", "findings.json"), JSON.stringify({
      findings: [
        {
          id: "F-1",
          source: "semgrep",
          repository: ".",
          file: "src/auth.ts",
          line: 1,
          severity: "high",
          category: "security",
          rule: "eval-unsafe",
          message: "Avoid eval usage in auth flow.",
          recommendation: "Use parser",
          metadata: { taskId: "MC-100" },
        },
      ],
    }));
    const context = staticAnalysis.buildAnalysisContextForTask({ repositoryRoot: src, taskId: "MC-100" });
    assert.equal(context.length >= 1, true);
    assert.equal(context[0].source, "semgrep");
  } finally {
    cleanup(root);
  }
});

test("merge-readiness blocks critical findings unless baselined", () => {
  const { root, src } = writeRepositoryWorkspace();
  try {
    write(path.join(src, "analysis-results", "findings.json"), JSON.stringify({
      findings: [
        {
          id: "F-CRIT",
          source: "semgrep",
          repository: ".",
          file: "src/auth.ts",
          line: 1,
          severity: "critical",
          category: "security",
          rule: "eval-unsafe",
          message: "Avoid eval usage in auth flow.",
          recommendation: "Use parser",
        },
      ],
      profile: "coder",
    }));
    const ready = staticAnalysis.validateMergeReadiness({
      findingFile: path.join(src, "analysis-results", "findings.json"),
      profile: "coder",
      pr: 12,
      repositoryRoot: src,
    });
    assert.equal(ready.merge_ready, false);
    assert.equal(ready.blocking_findings.length >= 1, true);

    write(path.join(src, "analysis-baselines", "coder.json"), JSON.stringify({
      fingerprints: ["./src/auth.ts#1#eval-unsafe#Avoid eval usage in auth flow."],
      generated_at: new Date().toISOString(),
    }));
    const readyAfterBaseline = staticAnalysis.validateMergeReadiness({
      findingFile: path.join(src, "analysis-results", "findings.json"),
      profile: "coder",
      pr: 12,
      repositoryRoot: src,
    });
    assert.equal(readyAfterBaseline.blocking_findings.length, 0);
  } finally {
    cleanup(root);
  }
});

test("compare-analysis-runs detects new and resolved findings", () => {
  const root = tempDir();
  try {
    const previous = path.join(root, "prev.json");
    const current = path.join(root, "curr.json");
    write(previous, JSON.stringify({
      findings: [
        { id: "F-1", repository: ".", file: "a.ts", line: 1, severity: "high", rule: "r1", message: "old", source: "semgrep" },
      ],
      generated_at: new Date().toISOString(),
    }));
    write(current, JSON.stringify({
      findings: [
        { id: "F-1", repository: ".", file: "a.ts", line: 1, severity: "critical", rule: "r1", message: "old", source: "semgrep" },
        { id: "F-2", repository: ".", file: "a.ts", line: 2, severity: "low", rule: "r2", message: "new", source: "semgrep" },
      ],
      generated_at: new Date().toISOString(),
    }));
    const delta = staticAnalysis.compareRuns({ previous, current });
    assert.equal(delta.delta.new.length, 1);
    assert.equal(delta.delta.resolved.length, 0);
    assert.equal(delta.delta.severityIncreases.length, 1);
    assert.equal(delta.delta.severityIncreases[0].findingId, "F-1");
  } finally {
      cleanup(root);
  }
});
