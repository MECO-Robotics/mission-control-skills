const engine = require("./engine");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repo" || arg === "--repository-root") {
      out.repositoryRoot = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outputDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--graph" || arg === "--graph-path" || arg === "--path") {
      out.graphPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--task") {
      out.taskId = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--query") {
      out.query = args[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !out._positional0) {
      out._positional0 = arg;
    } else if (!arg.startsWith("--") && !out._positional1) {
      out._positional1 = arg;
    }
  }
  return out;
}

function commandBuildProjectGraph(argv) {
  const args = parseArgs(argv);
  return engine.buildProjectGraph({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    profile: args.profile || "coder",
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-graphs"),
    outputFile: "project-graph.json",
    preferExternal: args.preferExternal !== false,
  });
}

function commandBuildTaskGraph(argv) {
  const args = parseArgs(argv);
  const taskId = args._positional0 || args.taskId;
  if (!taskId) {
    throw new Error("build-task-graph requires task id.");
  }
  return engine.buildTaskGraph({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    profile: args.profile || "coder",
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-graphs"),
    taskId,
  });
}

function commandQueryProjectGraph(argv) {
  const args = parseArgs(argv);
  const query = args._positional0 || args.query;
  if (!query) {
    throw new Error("query-project-graph requires a query string.");
  }
  return engine.queryProjectGraph({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    query,
    profile: args.profile || "coder",
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-graphs"),
    graphPath: args.graphPath,
    repository: args.repository,
    taskId: args.taskId,
    limit: args.limit,
  });
}

function commandExportGraphContext(argv) {
  const args = parseArgs(argv);
  return engine.exportGraphContext({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-context"),
    graphPath: args.graphPath || path.join(args.repositoryRoot || process.cwd(), "generated-graphs", "project-graph.json"),
    profile: args.profile || "coder",
    taskId: args._positional0 || args.taskId,
  });
}

function commandGenerateGraphifyConfig(argv) {
  const args = parseArgs(argv);
  const profile = args.profile || "coder";
  return engine.generateGraphifyConfig({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    profile,
  });
}

function commandSummarizeGraph(argv) {
  const args = parseArgs(argv);
  return engine.summarizeGraph({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-graphs"),
    graphPath: args.graphPath || path.join(args.repositoryRoot || process.cwd(), "generated-graphs", "project-graph.json"),
  });
}

function commandValidateGraph(argv) {
  const args = parseArgs(argv);
  const graphPath = args._positional0 || args.graphPath || args.path;
  if (!graphPath) {
    throw new Error("validate-graph requires a graph file path.");
  }
  return engine.validateGraph({
    repositoryRoot: args.repositoryRoot || process.cwd(),
    graphPath,
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "generated-graphs"),
  });
}

module.exports = {
  parseArgs,
  commandBuildProjectGraph,
  commandBuildTaskGraph,
  commandQueryProjectGraph,
  commandExportGraphContext,
  commandGenerateGraphifyConfig,
  commandSummarizeGraph,
  commandValidateGraph,
};
