const engine = require("./engine");
const path = require("node:path");

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
    if (arg === "--output-dir" || arg === "--out") {
      out.outputDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--index-dir" || arg === "--index") {
      out.outputDir = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--index-file") {
      out.indexFile = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--config") {
      out.configPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--query") {
      out.query = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--symbol") {
      out.symbol = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--sourcebot") {
      out.preferSourcebot = true;
      continue;
    }
    if (arg === "--profile") {
      out.profile = args[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !out.query && !out._query) {
      out._query = arg;
    }
  }
  out.repositoryRoot = path.resolve(out.repositoryRoot || process.cwd());
  return out;
}

function commandIndexRepositories(argv) {
  const args = parseArgs(argv);
  return engine.indexRepositories({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
    limit: args.limit,
  });
}

function commandSearchSymbol(argv) {
  const args = parseArgs(argv);
  return engine.searchSymbol({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    symbolName: args.symbol || args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchReferences(argv) {
  const args = parseArgs(argv);
  return engine.searchReferences({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    symbol: args.symbol || args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchCallers(argv) {
  const args = parseArgs(argv);
  return engine.searchCallers({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    symbol: args.symbol || args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchImplementations(argv) {
  const args = parseArgs(argv);
  return engine.searchImplementations({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    symbol: args.symbol || args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchApiUsage(argv) {
  const args = parseArgs(argv);
  return engine.searchApiUsage({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    query: args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchCrossRepository(argv) {
  const args = parseArgs(argv);
  return engine.searchCrossRepository({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    query: args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandSearchOwner(argv) {
  const args = parseArgs(argv);
  return engine.searchOwner({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir,
    indexFile: args.indexFile,
    query: args.query || args._query,
    limit: args.limit,
    configPath: args.configPath,
    preferSourcebot: args.preferSourcebot,
  });
}

function commandValidateSearchState(argv) {
  const args = parseArgs(argv);
  return engine.validateSearchState({
    repositoryRoot: args.repositoryRoot,
    outputDir: args.outputDir || path.join(args.repositoryRoot, "generated-code-search"),
    indexFile: args.indexFile,
    configPath: args.configPath,
    limit: args.limit,
  });
}

module.exports = {
  parseArgs,
  commandIndexRepositories,
  commandSearchSymbol,
  commandSearchReferences,
  commandSearchCallers,
  commandSearchImplementations,
  commandSearchApiUsage,
  commandSearchCrossRepository,
  commandSearchOwner,
  commandValidateSearchState,
};
