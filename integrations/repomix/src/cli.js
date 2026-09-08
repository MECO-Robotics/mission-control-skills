const engine = require("./engine");

function parseArgs(argv) {
  const out = {};
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
    } else if (arg === "--repo") {
      out.repositoryPath = args[i + 1];
      i += 1;
    } else if (arg === "--out") {
      out.outputDir = args[i + 1];
      i += 1;
    } else if (arg === "--file") {
      const file = args[++i];
      if (!file || file.startsWith("--")) throw new Error("--file requires a path.");
      (out.files ||= []).push(file);
    } else if (arg === "--graph-context") {
      out.includeGraphContext = true;
    } else if (arg === "--semantic-context") {
      out.includeSemanticContext = true;
    } else if (arg === "--static-analysis") {
      out.includeStaticAnalysis = true;
    } else if (arg === "--no-repomix") {
      out.preferRepomix = false;
    } else if (arg === "--no-graph-context") {
      out.includeGraphContext = false;
    } else if (arg.startsWith("--")) {
      // ignore unknown flags for forward compatibility
    } else if (!out._positional0) {
      out._positional0 = arg;
    } else if (!out._positional1) {
      out._positional1 = arg;
    }
  }
  return out;
}

function commandBuildRepoContext(argv) {
  const parsed = parseArgs(argv);
  const repositoryPath = parsed.repositoryPath || parsed._positional0 || process.cwd();
  const profile = parsed.profile || parsed._positional1 || "coder";
  const useRepomix = parsed.preferRepomix !== false && repositoryPath && profile;
  const result = engine.buildRepoContext({
    repositoryPath,
    profile,
    outputDir: parsed.outputDir,
    preferRepomix: useRepomix,
  });
  return result;
}

function commandBuildTaskContext(argv) {
  const parsed = parseArgs(argv);
  const taskId = parsed._positional0 || parsed.taskId;
  if (!taskId) {
    throw new Error("build-task-context requires task id.");
  }
  const profile = parsed.profile || "coder";
  return engine.buildTaskContext({
    repositoryPath: parsed.repositoryPath || process.cwd(),
    taskId,
    profile,
    outputDir: parsed.outputDir,
    files: parsed.files,
    includeGraphContext: parsed.includeGraphContext === true,
    includeSemanticContext: parsed.includeSemanticContext === true,
    includeStaticAnalysis: parsed.includeStaticAnalysis === true,
  });
}

function commandBuildPrContext(argv) {
  const parsed = parseArgs(argv);
  const prNumber = parsed._positional0 || parsed.prNumber;
  if (!prNumber) {
    throw new Error("build-pr-context requires PR number.");
  }
  const profile = parsed.profile || "reviewer";
  return engine.buildPrContext({
    repositoryPath: parsed.repositoryPath || process.cwd(),
    prNumber,
    profile,
    outputDir: parsed.outputDir,
    includeGraphContext: parsed.includeGraphContext !== false,
  });
}

function commandValidateContextBudget(argv) {
  const parsed = parseArgs(argv);
  const contextFile = parsed._positional0;
  const profile = parsed.profile;
  return engine.validateContextBudget({ contextFile, profile, repositoryPath: parsed.repositoryPath });
}

function commandSummarizeContext(argv) {
  const parsed = parseArgs(argv);
  const contextFile = parsed._positional0;
  return engine.summarizeContext({ contextFile, repositoryPath: parsed.repositoryPath });
}

function commandGenerateConfig(argv) {
  const parsed = parseArgs(argv);
  const profile = parsed.profile;
  return engine.generateRepomixConfig({
    profile,
    repositoryPath: parsed.repositoryPath || process.cwd(),
  });
}

module.exports = {
  parseArgs,
  commandBuildRepoContext,
  commandBuildTaskContext,
  commandBuildPrContext,
  commandValidateContextBudget,
  commandSummarizeContext,
  commandGenerateConfig,
};
