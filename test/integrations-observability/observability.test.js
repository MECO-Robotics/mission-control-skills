const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { test } = require("node:test");

const engine = require("../../integrations/observability/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mc-observability-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("loads config and prompt registry", () => {
  const cfg = engine.loadConfig();
  const registry = engine.loadPromptRegistry();
  assert.equal(typeof cfg.providers?.langfuse, "object");
  assert.equal(Boolean(registry.prompts?.length > 0), true);
});

test("creates a trace and updates index", () => {
  const root = tempDir();
  try {
    const result = engine.recordAgentRun({
      repositoryRoot: root,
      taskId: "MC-1",
      agentRole: "coder",
      promptId: "coder-agent-v1",
      inputSummary: "work",
      outputSummary: "done",
    });
    assert.equal(typeof result.trace_id, "string");
    assert.equal(result.agent_role, "coder");
    assert.equal(fs.existsSync(result.tracePath), true);
    const index = engine.readTraceIndex(path.join(root, "observability", "traces"));
    assert.equal(Array.isArray(index.traces), true);
    assert.equal(index.traces[0].trace_id, result.trace_id);
  } finally {
    cleanup(root);
  }
});

test("supports local-first mode without langfuse dependency", () => {
  const root = tempDir();
  try {
    const result = engine.recordEvaluationRun({
      repositoryRoot: root,
      taskId: "MC-7",
      suite: "reviewer",
      evaluationPath: path.join(root, "evaluations", "results.json"),
    });
    assert.equal(result.operation, "record-evaluation-run");
    assert.equal(result.trace_id.length > 0, true);
  } finally {
    cleanup(root);
  }
});

test("exports langfuse compatible payload", () => {
  const root = tempDir();
  try {
    write(path.join(root, "observability", "traces", "t1.json"), {
      trace_id: "t1",
      timestamp: new Date().toISOString(),
      task_id: "MC-1",
      repository: ".",
      agent_role: "architect",
      operation: "record-agent-run",
      prompt_id: "architect-agent-v1",
      prompt_version: "1.0.0",
      context_package: "generated-context",
      input_summary: "in",
      output_summary: "out",
      related_prs: [1, 2],
      related_findings: ["F1"],
      related_evaluations: ["E1"],
      metadata: {},
    });
    const payload = engine.exportLangfuseData({ repositoryRoot: root, outputFile: path.join(root, "langfuse.json") });
    assert.equal(payload.count, 1);
    const exported = JSON.parse(fs.readFileSync(path.join(root, "langfuse.json"), "utf8"));
    assert.equal(Array.isArray(exported.traces), true);
    assert.equal(exported.traces[0].id, "t1");
  } finally {
    cleanup(root);
  }
});

test("redacts token-like fields", () => {
  const cleaned = engine.redactObject({
    apiKey: "sk_live_abcdefghijk123",
    nested: { secret: "ghp_1234567890ab", normal: "value" },
  });
  assert.equal(cleaned.apiKey, "[REDACTED]");
  assert.equal(cleaned.nested.secret, "[REDACTED]");
  assert.equal(cleaned.nested.normal, "value");
});

test("links evaluation results to evaluation artifacts", () => {
  const root = tempDir();
  try {
    write(path.join(root, "evaluations", "results.json"), {
      evaluations: [
        {
          evaluation_id: "eval-abc",
          suite: "coder",
          task_id: "MC-11",
          score: 91,
          pass: true,
          max_score: 100,
        },
      ],
    });
    const result = engine.recordEvaluationRun({
      repositoryRoot: root,
      taskId: "MC-11",
      suite: "coder",
      evaluationPath: path.join(root, "evaluations", "results.json"),
    });
    assert.equal(result.related_evaluations.length, 1);
    assert.equal(result.metadata.provider, "evaluation");
  } finally {
    cleanup(root);
  }
});

test("links static-analysis findings in review loop and computes deltas", () => {
  const root = tempDir();
  try {
    write(path.join(root, "analysis-results", "before-findings.json"), {
      findings: [
        {
          id: "F1",
          file: "src/auth.ts",
          line: 1,
          severity: "low",
          rule: "old",
          repository: ".",
        },
      ],
    });
    write(path.join(root, "analysis-results", "findings.json"), {
      findings: [
        {
          id: "F1",
          file: "src/auth.ts",
          line: 1,
          severity: "high",
          rule: "old",
          repository: ".",
        },
        {
          id: "F2",
          file: "src/auth.ts",
          line: 2,
          severity: "low",
          rule: "new",
          repository: ".",
        },
      ],
    });
    const result = engine.recordReviewLoop({
      repositoryRoot: root,
      taskId: "MC-300",
      iterations: 2,
      beforeFindings: path.join(root, "analysis-results", "before-findings.json"),
      afterFindings: path.join(root, "analysis-results", "findings.json"),
    });
    assert.equal(result.operation, "record-review-loop");
    assert.equal(result.metadata.findings_severity_increases.length, 1);
    assert.equal(result.metadata.findings_resolved.length, 0);
  } finally {
    cleanup(root);
  }
});

test("validates traces and detects malformed trace files", () => {
  const root = tempDir();
  try {
    const traceDir = path.join(root, "observability", "traces");
    const idxPath = path.join(root, "observability");
    mkdirSync(traceDir, { recursive: true });
    write(path.join(root, "observability", "trace-index.json"), {
      generated_at: new Date().toISOString(),
      traces: [{ trace_id: "t-bad", timestamp: new Date().toISOString() }],
    });
    write(path.join(traceDir, "t-bad.json"), { operation: "record-agent-run" });
    const valid = engine.validateTraceState({ repositoryRoot: root, outputFile: path.join(root, "validation.json") });
    assert.equal(valid.valid, false);
    assert.equal(valid.failures.length >= 1, true);
  } finally {
    cleanup(root);
  }
});

test("compares traces for prompt and context deltas", () => {
  const root = tempDir();
  try {
    const base = engine.recordAgentRun({ repositoryRoot: root, taskId: "MC-1", agentRole: "coder", contextPackage: "generated-context/base" });
    const curr = engine.recordAgentRun({
      repositoryRoot: root,
      taskId: "MC-1",
      agentRole: "coder",
      contextPackage: "generated-context/current",
      promptId: "reviewer-agent-v1",
    });
    const diff = engine.compareAgentRuns({
      repositoryRoot: root,
      baseline: base.trace_id,
      current: curr.trace_id,
      outputFile: path.join(root, "trace-compare.json"),
    });
    assert.equal(diff.prompt_changes.changed, true);
    assert.equal(diff.context_changes.changed, true);
  } finally {
    cleanup(root);
  }
});
