const assert = require("node:assert/strict");
const { rmSync, mkdirSync, writeFileSync, existsSync, mkdtempSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const evaluation = require("../../integrations/evaluation/src/engine.js");
const promptfooProvider = require("../../integrations/evaluation/providers/promptfoo/index.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mc-eval-test-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("loads evaluation configuration and suite definitions", () => {
  const config = evaluation.loadConfig();
  assert.equal(Boolean(config.profiles?.architect), true);
  assert.equal(Boolean(config.profiles?.reviewer), true);
  const suite = evaluation.loadSuite("reviewer");
  assert.equal(suite.name, "reviewer");
  assert.equal(Array.isArray(suite.cases), true);
});

test("promptfoo provider falls back when command is unavailable", () => {
  const result = promptfooProvider.run({
    suite: { name: "coder", cases: [{ id: "case-1", query: "implement auth helper" }] },
    providerConfig: { binary: "__mc_missing_command_12345__" },
    outputDir: tempDir(),
  });
  assert.equal(result.available, false);
  assert.equal(typeof result.caseScores === "object", true);
});

test("run-evaluation supports retrieval suite in fallback mode", () => {
  const root = tempDir();
  try {
    write(path.join(root, "global-issues.json"), {
      tasks: [
        {
          id: "MC-100",
          title: "Authentication helper",
          repository: ".",
          files: ["src/auth.ts"],
        },
      ],
    });
    write(path.join(root, "dependency-map.json"), {
      dependencies: [{ from: "MC-100", to: "MC-200", type: "depends_on" }],
    });
    const result = evaluation.runEvaluation([
      "--repository-root",
      root,
      "--suite",
      "retrieval",
      "--provider",
      "missing-provider",
      "--result-dir",
      path.join(root, "evaluations"),
    ]);
    assert.equal(result.suite, "retrieval");
    assert.equal(result.profile, "retrieval");
    assert.equal(typeof result.score, "number");
    assert.equal(Boolean(result.metrics), true);
    assert.equal(Boolean(result.metrics.context_relevance), true);
  } finally {
    cleanup(root);
  }
});

test("run-evaluation supports reviewer suite with analysis findings and review file", () => {
  const root = tempDir();
  try {
    write(path.join(root, "analysis-results", "findings.json"), {
      findings: [
        {
          id: "F-1",
          source: "semgrep",
          repository: ".",
          file: "src/auth.ts",
          line: 12,
          severity: "high",
          category: "security",
          rule: "auth-header",
          message: "Use secure authentication headers.",
          recommendation: "Add strict header checks.",
        },
      ],
    });
    write(path.join(root, "analysis-results", "review-findings.md"), "# Review Findings\n- auth-header\n");
    const result = evaluation.runEvaluation([
      "--repository-root",
      root,
      "--suite",
      "reviewer",
      "--provider",
      "missing-provider",
      "--result-dir",
      path.join(root, "evaluations"),
    ]);
    assert.equal(result.suite, "reviewer");
    assert.equal(result.pass, true);
    assert.equal(typeof result.metrics.finding_quality, "number");
    assert.equal(typeof result.metrics.false_positive_rate, "number");
  } finally {
    cleanup(root);
  }
});

test("compares evaluation payloads and flags regressions", () => {
  const root = tempDir();
  try {
    const previousPath = path.join(root, "previous.json");
    const currentPath = path.join(root, "current.json");
    write(previousPath, {
      evaluations: [
        {
          suite: "coder",
          profile: "coder",
          score: 80,
          max_score: 100,
          pass: true,
          metrics: { implementation_correctness: 0.7 },
        },
      ],
    });
    write(currentPath, {
      evaluations: [
        {
          suite: "coder",
          profile: "coder",
          score: 72,
          max_score: 100,
          pass: true,
          metrics: { implementation_correctness: 0.45 },
        },
      ],
    });
    const delta = evaluation.compareEvaluations(["--previous", previousPath, "--current", currentPath]);
    assert.equal(delta.score_delta, -8);
    assert.equal(delta.regressions.length >= 1, true);
  } finally {
    cleanup(root);
  }
});

test("validates regressions against suite baseline", () => {
  const root = tempDir();
  try {
    const suiteResult = path.join(root, "evaluations", "results.json");
    const baselineResult = path.join(root, "baselines", "coder.json");
    write(suiteResult, {
      evaluations: [
        {
          suite: "coder",
          profile: "coder",
          score: 58,
          max_score: 100,
          pass: true,
          metrics: {},
        },
      ],
    });
    write(baselineResult, {
      evaluations: [
        {
          suite: "coder",
          profile: "coder",
          score: 74,
          max_score: 100,
          pass: true,
          metrics: {},
        },
      ],
    });
    const regression = evaluation.validateAgentRegression(["--current", suiteResult]);
    assert.equal(regression.passed, false);
    assert.equal(regression.blocking_regressions.length >= 1, true);
    assert.equal(regression.suite, "coder");
  } finally {
    cleanup(root);
  }
});

test("generates evaluation scorecard", () => {
  const root = tempDir();
  try {
    const resultsPath = path.join(root, "results.json");
    write(resultsPath, {
      evaluations: [
        {
          suite: "architect",
          profile: "architect",
          score: 88,
          max_score: 100,
          pass: true,
          metrics: { decomposition_quality: 0.8 },
        },
        {
          suite: "reviewer",
          profile: "reviewer",
          score: 67,
          max_score: 100,
          pass: false,
          metrics: { finding_quality: 0.5 },
        },
      ],
    });
    const scorecard = evaluation.generateScorecard(["--result-file", resultsPath]);
    assert.equal(typeof scorecard.suites, "number");
    assert.equal(scorecard.suites, 2);
    assert.equal(scorecard.passing, 1);
    const summary = path.resolve(scorecard.outputPath);
    assert.equal(existsSync(summary), true);
  } finally {
    cleanup(root);
  }
});
