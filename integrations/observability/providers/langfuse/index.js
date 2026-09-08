const fs = require("node:fs");
const path = require("node:path");

function now() {
  return new Date().toISOString();
}

function ensureOutputDir(outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

function mapTrace(trace = {}) {
  return {
    id: trace.trace_id,
    name: trace.operation || "agent-run",
    timestamp: trace.timestamp || now(),
    metadata: {
      taskId: trace.task_id || null,
      repository: trace.repository || null,
      agentRole: trace.agent_role || null,
      promptId: trace.prompt_id || null,
      promptVersion: trace.prompt_version || null,
      contextPackage: trace.context_package || null,
      relatedPrs: trace.related_prs || [],
      relatedFindings: trace.related_findings || [],
      relatedEvaluations: trace.related_evaluations || [],
      source: trace.metadata?.source || "local",
      inputSummary: trace.input_summary || "",
      outputSummary: trace.output_summary || "",
      metadata: trace.metadata || {},
    },
  };
}

function mapPayload(traces = [], options = {}) {
  return {
    generatedAt: now(),
    repositoryRoot: options.repositoryRoot || null,
    provider: "langfuse",
    count: traces.length,
    traces: traces.map((row) => mapTrace(row)),
    remote: options.sendRemote || false,
  };
}

function exportTraces(options = {}) {
  const traces = Array.isArray(options.traces) ? options.traces : [];
  const outputPath = options.outputPath || path.join(process.cwd(), "observability", "langfuse-export.json");
  const payload = mapPayload(traces, options);

  ensureOutputDir(outputPath);
  if (options.sendRemote) {
    payload.error = "remote sync disabled in this mode";
  }

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");

  return {
    path: outputPath,
    count: traces.length,
    provider: "langfuse",
    sent: false,
  };
}

function isAvailable() {
  return true;
}

module.exports = {
  isAvailable,
  mapTrace,
  exportTraces,
};
