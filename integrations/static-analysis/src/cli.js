const path = require("node:path");
const engine = require("./engine");

function parseArgs(argv) {
  const out = {};
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--repo") {
      out.repository = args[i + 1];
      i += 1;
    } else if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
    } else if (arg === "--branch") {
      out.branch = args[i + 1];
      i += 1;
    } else if (arg === "--pr") {
      out.pr = args[i + 1];
      i += 1;
    } else if (arg === "--result-dir") {
      out.resultDir = args[i + 1];
      i += 1;
    } else if (arg === "--baseline") {
      out.baseline = args[i + 1];
      i += 1;
    } else if (arg === "--previous") {
      out.previous = args[i + 1];
      i += 1;
    } else if (arg === "--current") {
      out.current = args[i + 1];
      i += 1;
    } else if (arg === "--findings") {
      out.findingFile = args[i + 1];
      i += 1;
    } else if (arg === "--out") {
      out.outputFile = args[i + 1];
      i += 1;
    } else if (arg === "--analyzer") {
      out.analyzer = args[i + 1];
      i += 1;
    } else if (!out._positional0) {
      out._positional0 = arg;
    } else if (!out._positional1) {
      out._positional1 = arg;
    }
  }
  return out;
}

function commandRunAnalysis(argv) {
  const parsed = parseArgs(argv);
  return engine.runAnalysis({
    repositoryRoot: parsed.repository || path.resolve(parsed._positional0 || process.cwd()),
    profile: parsed.profile || parsed._positional1 || "coder",
    branch: parsed.branch,
    resultDir: parsed.resultDir,
  });
}

function commandParseAnalysisResults(argv) {
  const parsed = parseArgs(argv);
  const sourcePath = path.resolve(parsed._positional0 || parsed.findingFile || "");
  if (!sourcePath) throw new Error("parse-analysis-results requires source path");
  return engine.parseAnalysisResults({
    inputPath: sourcePath,
    profile: parsed.profile || "coder",
    analyzer: parsed.analyzer,
  });
}

function commandGenerateReviewFindings(argv) {
  const parsed = parseArgs(argv);
  return engine.generateReviewFindings({
    findingFile: parsed.findingFile || parsed._positional0,
    outputFile: parsed.outputFile,
    profile: parsed.profile,
  });
}

function commandGenerateFixLoop(argv) {
  const parsed = parseArgs(argv);
  return engine.generateFixLoop({
    findingFile: parsed.findingFile || parsed._positional0,
    outputFile: parsed.outputFile,
    repository: parsed.repository,
  });
}

function commandCompareRuns(argv) {
  const parsed = parseArgs(argv);
  return engine.compareRuns({
    previous: parsed.previous || parsed._positional0,
    current: parsed.current || parsed._positional1,
    outputFile: parsed.outputFile,
  });
}

function commandValidateMergeReadiness(argv) {
  const parsed = parseArgs(argv);
  return engine.validateMergeReadiness({
    findingFile: parsed.findingFile,
    pr: parsed.pr || parsed._positional0,
    profile: parsed.profile,
    repositoryRoot: parsed.repository,
  });
}

function commandExportAnalysisSummary(argv) {
  const parsed = parseArgs(argv);
  return engine.exportAnalysisSummary({
    findingFile: parsed.findingFile || parsed._positional0,
    outputFile: parsed.outputFile,
    profile: parsed.profile,
    previous: parsed.previous || null,
    pr: parsed.pr,
  });
}

module.exports = {
  parseArgs,
  commandRunAnalysis,
  commandParseAnalysisResults,
  commandGenerateReviewFindings,
  commandGenerateFixLoop,
  commandCompareRuns,
  commandValidateMergeReadiness,
  commandExportAnalysisSummary,
};
