const path = require("node:path");
const engine = require("./engine");

function parseArgs(argv) {
  const out = {};
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--repository-root" || arg === "--repo") {
      out.repositoryRoot = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--task") {
      out.taskId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--role") {
      out.agentRole = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--operation") {
      out.operation = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--prompt-id") {
      out.promptId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--prompt-version") {
      out.promptVersion = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--context-path" || arg === "--context") {
      out.contextPackage = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--excluded" || arg === "--excluded-files" || arg === "--excludedFile") {
      out.excludedFiles = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--trace-id") {
      out.traceId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--query") {
      out.query = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--pr") {
      out.pr = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--input-summary") {
      out.inputSummary = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output-summary") {
      out.outputSummary = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--provider") {
      out.provider = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--send-remote") {
      out.sendRemote = true;
      continue;
    }
    if (arg === "--evaluator") {
      out.providerOverride = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--evaluation-file" || arg === "--evaluation-path") {
      out.evaluationPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--suite") {
      out.suite = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--results") {
      out.results = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repository") {
      out.repository = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--iterations") {
      out.iterations = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--before-findings") {
      out.beforeFindings = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--after-findings") {
      out.afterFindings = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--related-prs") {
      out.relatedPrs = args[i + 1].split(",").filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--related-findings") {
      out.relatedFindings = args[i + 1].split(",").filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--baseline") {
      out.baseline = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--current") {
      out.current = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--output-file") {
      out.outputFile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (!out._positional0) {
      out._positional0 = arg;
    } else if (!out._positional1) {
      out._positional1 = arg;
    }
  }
  return out;
}

function commandRecordTrace(argv) {
  const parsed = parseArgs(argv);
  return engine.recordTrace(parsed);
}

function commandRecordAgentRun(argv) {
  const parsed = parseArgs(argv);
  return engine.recordAgentRun(parsed);
}

function commandRecordContextPackage(argv) {
  const parsed = parseArgs(argv);
  return engine.recordContextPackage(parsed);
}

function commandRecordRetrievalRun(argv) {
  const parsed = parseArgs(argv);
  return engine.recordRetrievalRun(parsed);
}

function commandRecordReviewLoop(argv) {
  const parsed = parseArgs(argv);
  return engine.recordReviewLoop(parsed);
}

function commandRecordEvaluationRun(argv) {
  const parsed = parseArgs(argv);
  return engine.recordEvaluationRun(parsed);
}

function commandExportTraceSummary(argv) {
  const parsed = parseArgs(argv);
  return engine.exportTraceSummary(parsed);
}

function commandCompareAgentRuns(argv) {
  const parsed = parseArgs(argv);
  return engine.compareAgentRuns(parsed);
}

function commandValidateTraceState(argv) {
  const parsed = parseArgs(argv);
  return engine.validateTraceState(parsed);
}

module.exports = {
  parseArgs,
  commandRecordTrace,
  commandRecordAgentRun,
  commandRecordContextPackage,
  commandRecordRetrievalRun,
  commandRecordReviewLoop,
  commandRecordEvaluationRun,
  commandExportTraceSummary,
  commandCompareAgentRuns,
  commandValidateTraceState,
};
