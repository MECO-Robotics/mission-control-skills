const engine = require("./engine");
const path = require("node:path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") {
      out.profile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--board-type" || arg === "--type") {
      out.boardType = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--board-id" || arg === "--id") {
      out.boardId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--entry-id") {
      out.entryId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--entry-type") {
      out.entryType = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--status") {
      out.status = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--summary") {
      out.summary = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--details") {
      out.details = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--task") {
      out.task = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--symbol") {
      out.symbol = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--query") {
      out.query = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--finding" || arg === "--finding-id") {
      out.finding = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repository") {
      out.repository = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repository-root" || arg === "--repo-root") {
      out.repositoryRoot = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--state-dir") {
      out.stateDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--archive-dir") {
      out.archiveDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--reason" || arg === "--detail") {
      out.details = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--author-role") {
      out.authorRole = argv[i + 1];
      i += 1;
      continue;
    }
    if (!arg.startsWith("--") && !out._positional0) {
      out._positional0 = arg;
    } else if (!arg.startsWith("--") && !out._positional1) {
      out._positional1 = arg;
    } else if (!arg.startsWith("--") && !out._positional2) {
      out._positional2 = arg;
    }
  }
  return out;
}

function optionsForRepository(parsed) {
  return {
    repositoryRoot: path.resolve(parsed.repositoryRoot || process.cwd()),
    stateDir: parsed.stateDir,
    archiveDir: parsed.archiveDir,
    boardType: parsed.boardType,
    boardId: parsed.boardId,
    profile: parsed.profile,
    repository: parsed.repository,
    actor: "system",
    authorRole: parsed.authorRole,
    status: parsed.status,
    task: parsed.task,
  };
}

function commandCreateBoard(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  if (!boardType || !boardId) {
    throw new Error("create-board requires <board-type> <board-id>");
  }
  return engine.createBoard({
    ...optionsForRepository(args),
    boardType,
    boardId,
    details: args.details || "",
    relatedTasks: args.task ? [args.task] : [],
  });
}

function commandCreateEntry(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  const summary = args.summary || args._positional2 || "";
  if (!boardType || !boardId) {
    throw new Error("create-entry requires <board-type> <board-id> [summary]");
  }
  if (!summary) {
    throw new Error("create-entry requires an entry summary");
  }
  return engine.createEntry(
    boardId,
    {
      entry_type: args.entryType || "note",
      summary,
      details: args.details || "",
      status: args.status || "open",
      author_role: args.authorRole || "architect",
      related_tasks: args.task ? [args.task] : [],
      related_symbols: args.symbol ? [args.symbol] : [],
      related_findings: args.finding ? [args.finding] : [],
    },
    {
      ...optionsForRepository(args),
      boardType,
      actor: args.authorRole || "architect",
    },
  );
}

function commandUpdateEntry(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  const entryId = args.entryId || args._positional2;
  if (!boardType || !boardId || !entryId) {
    throw new Error("update-entry requires <board-type> <board-id> <entry-id>");
  }
  return engine.updateEntry(boardId, entryId, {
    status: args.status,
    summary: args.summary,
    details: args.details,
    related_tasks: args.task ? [args.task] : undefined,
    related_symbols: args.symbol ? [args.symbol] : undefined,
    related_findings: args.finding ? [args.finding] : undefined,
    actor: args.authorRole || "architect",
  }, {
    ...optionsForRepository(args),
    boardType,
    actor: args.authorRole || "architect",
  });
}

function commandResolveEntry(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  const entryId = args.entryId || args._positional2;
  if (!boardType || !boardId || !entryId) {
    throw new Error("resolve-entry requires <board-type> <board-id> <entry-id>");
  }
  return engine.resolveEntry(boardId, entryId, {
    status: args.status || "resolved",
    details: args.details || "",
    actor: args.authorRole || "architect",
    ...optionsForRepository(args),
    boardType,
  });
}

function commandSearchBoard(argv) {
  const args = parseArgs(argv);
  return engine.searchBoards(args.repositoryRoot || process.cwd(), {
    ...optionsForRepository(args),
    query: args._positional0 || args.query || "",
    boardType: args.boardType,
    entryType: args.entryType,
    status: args.status,
    taskId: args.task,
    symbol: args.symbol,
    findingId: args.finding,
    limit: args.limit,
  });
}

function commandSummarizeBoard(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  if (!boardType || !boardId) {
    throw new Error("summarize-board requires <board-type> <board-id>");
  }
  return engine.summarizeBoard(boardId, {
    ...optionsForRepository(args),
    boardType,
    outputDir: args.outputDir || path.join(args.repositoryRoot || process.cwd(), "blackboard", "summaries"),
    repository: args.repository,
  });
}

function commandArchiveBoard(argv) {
  const args = parseArgs(argv);
  const boardType = args.boardType || args._positional0;
  const boardId = args.boardId || args._positional1;
  if (!boardType || !boardId) {
    throw new Error("archive-board requires <board-type> <board-id>");
  }
  return engine.archiveBoard(boardId, {
    ...optionsForRepository(args),
    boardType,
    reason: args.details || args.reason,
  });
}

function commandValidateBoard(argv) {
  const args = parseArgs(argv);
  return engine.validateBoard({
    ...optionsForRepository(args),
    boardPath: args._positional0 || args.boardPath,
    boardType: args.boardType,
    boardId: args.boardId,
  });
}

module.exports = {
  parseArgs,
  commandCreateBoard,
  commandCreateEntry,
  commandUpdateEntry,
  commandResolveEntry,
  commandSearchBoard,
  commandSummarizeBoard,
  commandArchiveBoard,
  commandValidateBoard,
};
