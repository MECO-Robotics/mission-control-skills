const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_STATE_DIR = path.join("blackboard", "state");
const DEFAULT_ARCHIVE_DIR = path.join("blackboard", "archives");

const VALID_BOARD_TYPES = new Set([
  "task-board",
  "repository-board",
  "review-board",
  "release-board",
  "architecture-board",
]);

const VALID_ENTRY_TYPES = new Set([
  "hypothesis",
  "plan",
  "finding",
  "question",
  "decision",
  "risk",
  "dependency",
  "note",
  "action_item",
]);

const VALID_ENTRY_STATUSES = new Set(["open", "resolved", "rejected", "superseded"]);
const VALID_BOARD_STATUSES = new Set(["active", "archived", "locked"]);

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function nowTrimmed(value) {
  return String(value || "").trim();
}

function normalizeBoardType(raw = "") {
  return nowTrimmed(raw).toLowerCase();
}

function normalizeStatus(raw = "open") {
  const value = nowTrimmed(raw).toLowerCase();
  return VALID_ENTRY_STATUSES.has(value) ? value : "open";
}

function normalizeBoardStatus(raw = "active") {
  const value = nowTrimmed(raw).toLowerCase();
  return VALID_BOARD_STATUSES.has(value) ? value : "active";
}

function normalizeId(raw = "") {
  return nowTrimmed(raw)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizePath(raw = "") {
  return nowTrimmed(raw).replace(/^\/+/, "");
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const normalized = nowTrimmed(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseList(value) {
  if (Array.isArray(value)) return dedupe(value);
  if (typeof value === "string" && value.trim()) return dedupe([value]);
  return [];
}

function stateRoot(repositoryRoot, options = {}) {
  return path.resolve(repositoryRoot, options.stateDir || DEFAULT_STATE_DIR);
}

function archiveRoot(repositoryRoot, options = {}) {
  return path.resolve(repositoryRoot, options.archiveDir || DEFAULT_ARCHIVE_DIR);
}

function boardTypeDir(repositoryRoot, boardType, options = {}) {
  return path.join(stateRoot(repositoryRoot, options), boardType);
}

function boardFilePath(repositoryRoot, boardType, boardId, options = {}) {
  return path.join(boardTypeDir(repositoryRoot, boardType, options), `${normalizeId(boardId)}.json`);
}

function archiveFilePath(repositoryRoot, boardType, boardId, options = {}) {
  return path.join(archiveRoot(repositoryRoot, options), boardType, `${normalizeId(boardId)}.json`);
}

function makeBoardEvent(action, actor, reason, metadata = {}) {
  return {
    action,
    actor: nowTrimmed(actor || "system"),
    at: nowIso(),
    reason: nowTrimmed(reason || action),
    metadata: metadata || {},
  };
}

function nowEvent(actor, reason, metadata = {}) {
  return makeBoardEvent("event", actor, reason, metadata);
}

function normalizeEntry(raw = {}) {
  return {
    id: normalizeId(raw.id || `entry-${hash(JSON.stringify(raw)).slice(0, 10)}`),
    board_id: nowTrimmed(raw.board_id),
    entry_type: nowTrimmed(raw.entry_type || raw.type || "note"),
    status: normalizeStatus(raw.status || "open"),
    author_role: nowTrimmed(raw.author_role || raw.authorRole || raw.actor || "architect"),
    summary: nowTrimmed(raw.summary || raw.title),
    details: nowTrimmed(raw.details || ""),
    related_tasks: parseList(raw.related_tasks || raw.relatedTasks),
    related_files: parseList(raw.related_files || raw.relatedFiles),
    related_symbols: parseList(raw.related_symbols || raw.relatedSymbols),
    related_findings: parseList(raw.related_findings || raw.relatedFindings),
    metadata: raw.metadata || {},
    created_at: raw.created_at || nowIso(),
    updated_at: raw.updated_at || nowIso(),
    history: Array.isArray(raw.history) ? raw.history : [],
  };
}

function normalizeBoard(raw = {}, options = {}) {
  const boardType = normalizeBoardType(raw.board_type || raw.type);
  const boardId = normalizeId(raw.board_id || raw.id);

  return {
    board_id: boardId,
    board_type: boardType,
    repository: normalizePath(raw.repository || options.repository || ""),
    status: normalizeBoardStatus(raw.status || "active"),
    metadata: raw.metadata || {},
    created_at: raw.created_at || nowIso(),
    updated_at: raw.updated_at || nowIso(),
    related_tasks: parseList(raw.related_tasks),
    events: Array.isArray(raw.events) ? raw.events : [],
    entries: Array.isArray(raw.entries) ? raw.entries.map(normalizeEntry) : [],
  };
}

function collectBoards(repositoryRoot, options = {}) {
  const root = stateRoot(repositoryRoot, options);
  const boards = [];
  if (!fs.existsSync(root)) return boards;
  const boardTypes = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const typeEntry of boardTypes) {
    const boardType = typeEntry.name;
    if (!VALID_BOARD_TYPES.has(boardType)) continue;
    const boardDir = path.join(root, boardType);
    for (const file of fs.readdirSync(boardDir)) {
      if (!file.toLowerCase().endsWith(".json")) continue;
      const boardPath = path.join(boardDir, file);
      const raw = readJson(boardPath);
      if (!raw) continue;
      boards.push(normalizeBoard({ ...raw, filePath: boardPath }));
    }
  }
  boards.sort((a, b) => `${a.board_type}|${a.board_id}`.localeCompare(`${b.board_type}|${b.board_id}`));
  return boards;
}

function materializeLatestEntries(entries = []) {
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

function collectBoardEntries(repositoryRoot, options = {}) {
  const boards = collectBoards(repositoryRoot, options);
  const out = [];
  for (const board of boards) {
    const entries = materializeLatestEntries(board.entries || []);
    for (const entry of entries) {
      out.push({
        board_id: board.board_id,
        board_type: board.board_type,
        board_repository: board.repository || "",
        ...entry,
      });
    }
  }
  out.sort((a, b) => `${a.board_type}|${a.board_id}|${a.created_at}`.localeCompare(`${b.board_type}|${b.board_id}|${b.created_at}`));
  return out;
}

function listBoards(repositoryRoot, options = {}) {
  return collectBoards(repositoryRoot, options).map((board) => ({
    ...board,
    entry_count: Array.isArray(board.entries) ? board.entries.length : 0,
  }));
}

function findBoardById(repositoryRoot, boardType, boardId, options = {}) {
  const payload = readJson(boardFilePath(repositoryRoot, boardType, boardId, options));
  if (!payload) return null;
  const board = normalizeBoard(payload, { repository: payload.repository });
  if (!board.board_id || !board.board_type) return null;
  return board;
}

function createBoard(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardType = normalizeBoardType(options.boardType || options.type);
  const boardId = normalizeId(options.boardId || options.id || options.reference);

  if (!VALID_BOARD_TYPES.has(boardType)) {
    throw new Error(`invalid board type: ${options.boardType || options.type}`);
  }
  if (!boardId) throw new Error("board id is required");

  const boardPath = boardFilePath(repositoryRoot, boardType, boardId, options);
  const existing = readJson(boardPath);
  if (existing) {
    return { board: normalizeBoard(existing), created: false, boardPath };
  }

  const now = nowIso();
  const relatedTasks =
    parseList(options.related_tasks || options.relatedTasks || (boardType === "task-board" ? [boardId] : []));

  const board = {
    board_id: boardId,
    board_type: boardType,
    repository: normalizePath(options.repository || options.repo || ""),
    status: normalizeBoardStatus(options.status || "active"),
    metadata: options.metadata || {},
    related_tasks: relatedTasks,
    created_at: now,
    updated_at: now,
    entries: [],
    events: [
      makeBoardEvent(
        "create-board",
        options.author || options.authorRole || options.actor || "architect",
        options.reason || "board created",
        { boardType, boardId },
      ),
    ],
  };

  board.entries.push({
    id: "meta",
    board_id: boardId,
    entry_type: "note",
    status: "open",
    author_role: options.author || options.authorRole || "architect",
    summary: `${boardType} initialized`,
    details: nowTrimmed(options.details || ""),
    related_tasks: relatedTasks,
    related_files: dedupe(options.related_files || []),
    related_symbols: dedupe(options.related_symbols || []),
    related_findings: dedupe(options.related_findings || []),
    metadata: { source: "board-meta" },
    created_at: now,
    updated_at: now,
    history: [nowEvent(options.author || options.actor || "system", "meta entry", {})],
  });

  writeJson(boardPath, board);
  return { board: normalizeBoard(board), created: true, boardPath };
}

function makeEntryId(board, draft = {}) {
  const seed = `${board.board_id}|${draft.entry_type}|${draft.summary}|${draft.details}|${draft.author_role}`;
  const base = `entry-${hash(seed).slice(0, 12)}`;
  const existing = new Set((board.entries || []).map((row) => row.id));
  let candidate = base;
  let i = 1;
  while (existing.has(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  return candidate;
}

function createEntry(boardId, values = {}, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardType = normalizeBoardType(options.boardType || options.type);
  const normalizedBoardId = normalizeId(boardId);
  if (!boardType || !normalizedBoardId) {
    throw new Error("board id and board type are required");
  }

  const board = findBoardById(repositoryRoot, boardType, normalizedBoardId, options);
  if (!board) {
    throw new Error(`board not found: ${boardType}/${normalizedBoardId}`);
  }
  const entryType = nowTrimmed(values.entry_type || values.entryType || values.type);
  if (!VALID_ENTRY_TYPES.has(entryType)) throw new Error(`invalid entry type: ${entryType}`);

  const now = nowIso();
  const summary = nowTrimmed(values.summary || values.title);
  if (!summary) throw new Error("entry summary is required");

  const entry = normalizeEntry({
    ...values,
    board_id: board.board_id,
    entry_type: entryType,
    status: values.status || "open",
    summary,
    details: values.details || "",
    author_role: values.author_role || values.authorRole || values.actor || "architect",
    metadata: values.metadata || {},
    created_at: now,
    updated_at: now,
    id: values.id || undefined,
    history: [],
  });
  if (entry.id === "meta" || board.entries.some((row) => row.id === entry.id)) {
    throw new Error(`entry already exists: ${entry.id}`);
  }

  entry.history = [nowEvent(values.author || values.actor || "system", "create-entry", { entry_type: entryType })];
  board.entries = [...board.entries, entry];
  board.updated_at = now;
  board.events.push(
    makeBoardEvent(
      "create-entry",
      values.author || values.actor || "system",
      `create entry ${entry.id}`,
      {
        entry_id: entry.id,
        entry_type: entryType,
      },
    ),
  );

  const boardPath = boardFilePath(repositoryRoot, boardType, normalizedBoardId, options);
  writeJson(boardPath, board);
  return { board, entry, boardPath, entry_id: entry.id };
}

function mergeList(existing = [], next = []) {
  return dedupe([...(existing || []), ...(next || [])]);
}

function updateEntry(boardId, entryId, updates = {}, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardType = normalizeBoardType(options.boardType || options.type);
  const normalizedBoardId = normalizeId(boardId);
  const normalizedEntryId = normalizeId(entryId || "");

  if (!boardType || !normalizedBoardId || !normalizedEntryId) {
    throw new Error("board id, board type, and entry id are required");
  }

  const board = findBoardById(repositoryRoot, boardType, normalizedBoardId, options);
  if (!board) throw new Error(`board not found: ${boardType}/${normalizedBoardId}`);

  const before = board.entries.find((row) => row.id === normalizedEntryId);
  if (!before) throw new Error(`entry not found: ${normalizedEntryId}`);
  const merged = {
    ...before,
    summary: nowTrimmed(updates.summary !== undefined ? updates.summary : before.summary),
    details: nowTrimmed(updates.details !== undefined ? updates.details : before.details),
    status: updates.status ? normalizeStatus(updates.status) : before.status,
    author_role: nowTrimmed(updates.author_role || updates.actor || before.author_role),
    related_tasks: updates.related_tasks ? mergeList(before.related_tasks, updates.related_tasks) : before.related_tasks,
    related_files: updates.related_files ? mergeList(before.related_files, updates.related_files) : before.related_files,
    related_symbols: updates.related_symbols ? mergeList(before.related_symbols, updates.related_symbols) : before.related_symbols,
    related_findings: updates.related_findings ? mergeList(before.related_findings, updates.related_findings) : before.related_findings,
    metadata: updates.metadata || before.metadata || {},
    updated_at: nowIso(),
  };
  const history = Array.isArray(before.history) ? before.history : [];
  merged.history = [
    ...history,
    nowEvent(updates.actor || updates.author || "system", "update-entry", {
      before: { ...before },
      after: { ...merged },
    }),
  ];

  board.entries = board.entries.map((row) => (row.id === normalizedEntryId ? merged : row));
  board.updated_at = nowIso();
  board.events.push(
    makeBoardEvent(
      updates.actor || updates.author || "system",
      `update entry ${normalizedEntryId}`,
      { entry_id: normalizedEntryId },
    ),
  );

  const boardPath = boardFilePath(repositoryRoot, boardType, normalizedBoardId, options);
  writeJson(boardPath, board);
  return { board, entry: merged, boardPath };
}

function resolveEntry(boardId, entryId, options = {}) {
  return updateEntry(boardId, entryId, { status: options.status || "resolved", details: options.details }, options);
}

function matchQuery(row, query) {
  const candidate = `${row.summary} ${row.details} ${row.entry_type} ${row.status} ${row.symbol || ""} ${row.id}`.toLowerCase();
  if (!query) return false;
  return candidate.includes(query.toLowerCase());
}

function searchBoards(repositoryRoot, options = {}) {
  const root = path.resolve(repositoryRoot);
  const query = nowTrimmed(options.query || "").toLowerCase();
  const boardType = normalizeBoardType(options.boardType || options.type);
  const taskId = nowTrimmed(options.taskId || options.task || "").toUpperCase();
  const symbol = nowTrimmed(options.symbol);
  const findingId = normalizeId(options.findingId || options.finding);
  const entryType = nowTrimmed(options.entryType || options.entry_type);
  const status = normalizeStatus(options.status || "open");

  const statusFilterActive = Boolean(options.status);
  const boardEntries = collectBoardEntries(root, options);
  const rows = [];

  for (const entry of boardEntries) {
    const isMeta = entry.id === "meta";
    if (boardType && entry.board_type !== boardType) continue;
    if (entryType && entry.entry_type !== entryType) continue;
    if (statusFilterActive && entry.status !== status) continue;
    if (taskId && !isMeta && !entry.related_tasks.includes(taskId) && !entry.board_id.includes(taskId)) continue;
    if (symbol && !entry.related_symbols.includes(symbol)) continue;
    if (findingId && !entry.related_findings.includes(findingId)) continue;
    if (query && !isMeta && !matchQuery(entry, query)) continue;

    const matched = materializeLatestEntries([entry]);
    if (!matched.length) continue;
    rows.push({
      ...entry,
      score: query ? 1 : 0.5,
      reason: query ? "text match" : "filter match",
      rank: query ? query.split(/\s+/).length : 1,
    });
  }

  rows.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (b.score !== a.score) return b.score - a.score;
    return `${a.updated_at}`.localeCompare(`${b.updated_at}`);
  });

  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 200;
  return {
    query: query || null,
    boardType: boardType || null,
    filters: { taskId: taskId || null, symbol: symbol || null, findingId: findingId || null, entryType: entryType || null },
    total: rows.length,
    results: rows.slice(0, limit),
    generated_at: nowIso(),
  };
}

function summarizeBoard(boardId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardType = normalizeBoardType(options.boardType || options.type);
  const normalizedBoardId = normalizeId(boardId);

  if (!boardType || !normalizedBoardId) throw new Error("board id and board type are required");
  const board = findBoardById(repositoryRoot, boardType, normalizedBoardId, options);
  if (!board) throw new Error(`board not found: ${boardType}/${normalizedBoardId}`);

  const openRisks = [];
  const openQuestions = [];
  const activeFindings = [];
  const activePlans = [];
  for (const entry of materializeLatestEntries(board.entries || [])) {
    if (entry.status !== "open" || entry.id === "meta") continue;
    if (entry.entry_type === "risk") openRisks.push(entry);
    if (entry.entry_type === "question") openQuestions.push(entry);
    if (entry.entry_type === "finding") activeFindings.push(entry);
    if (entry.entry_type === "plan") activePlans.push(entry);
  }

  const payload = {
    board_id: board.board_id,
    board_type: board.board_type,
    generated_at: nowIso(),
    summary: {
      open_risks: openRisks,
      unresolved_questions: openQuestions,
      active_findings: activeFindings,
      active_plans: activePlans,
    },
  };

  const outDir = path.resolve(options.outputDir || boardTypeDir(repositoryRoot, boardType, options));
  const mdPath = path.join(outDir, "board-summary.md");
  const jsonPath = path.join(outDir, `${board.board_id}.board-summary.json`);
  const lines = [];
  lines.push(`# Board Summary`);
  lines.push(`Board: ${board.board_id}`);
  lines.push(`Type: ${board.board_type}`);
  lines.push(`Generated: ${payload.generated_at}`);
  lines.push("");
  lines.push(`Open risks: ${openRisks.length}`);
  lines.push(`Unresolved questions: ${openQuestions.length}`);
  lines.push(`Active findings: ${activeFindings.length}`);
  lines.push(`Active plans: ${activePlans.length}`);
  lines.push("");
  lines.push("## Open risks");
  for (const row of openRisks) lines.push(`- [${row.id}] ${row.summary}`);
  lines.push("");
  lines.push("## Unresolved questions");
  for (const row of openQuestions) lines.push(`- [${row.id}] ${row.summary}`);
  lines.push("");
  lines.push("## Active findings");
  for (const row of activeFindings) lines.push(`- [${row.id}] ${row.summary}`);
  lines.push("");
  lines.push("## Active plans");
  for (const row of activePlans) lines.push(`- [${row.id}] ${row.summary}`);

  writeJson(jsonPath, payload);
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");

  return {
    board_id: board.board_id,
    board_type: board.board_type,
    output: {
      markdown: mdPath,
      json: jsonPath,
    },
    payload,
  };
}

function summarizeAllBoards(repositoryRoot, options = {}) {
  const boards = listBoards(repositoryRoot, options);
  const outDir = path.resolve(options.outputDir || stateRoot(repositoryRoot, options));
  const mdPath = path.join(outDir, "blackboards-summary.md");
  const lines = [];
  lines.push("# Blackboard Summary");
  lines.push(`Generated: ${nowIso()}`);
  lines.push("");
  for (const board of boards) {
    lines.push(
      `- ${board.board_type}:${board.board_id} (entries:${board.entry_count}, status:${board.status}, repo:${board.repository || "-"})`,
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  return {
    output: mdPath,
    boardCount: boards.length,
  };
}

function archiveBoard(boardId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardType = normalizeBoardType(options.boardType || options.type);
  const normalizedBoardId = normalizeId(boardId || options.id);
  if (!boardType || !normalizedBoardId) throw new Error("board id and board type are required");

  const board = findBoardById(repositoryRoot, boardType, normalizedBoardId, options);
  if (!board) throw new Error(`board not found: ${boardType}/${normalizedBoardId}`);

  const boardPath = boardFilePath(repositoryRoot, boardType, normalizedBoardId, options);
  board.status = "archived";
  board.updated_at = nowIso();
  board.events.push(makeBoardEvent(
    options.actor || options.author || "system",
    `archive board ${normalizedBoardId}`,
    { reason: options.reason || "manual archive" },
  ));

  writeJson(boardPath, board);
  const archived = archiveFilePath(repositoryRoot, boardType, normalizedBoardId, options);
  writeJson(archived, board);
  return { board_id: board.board_id, board_type: board.board_type, archivePath: archived, status: board.status };
}

function validateBoard(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
  const boardPath = options.boardPath ? path.resolve(options.boardPath) : null;
  const boards = boardPath ? [readJson(boardPath)] : collectBoards(repositoryRoot, options);
  const failures = [];
  const toValidate = boards.filter(Boolean);

  for (const rawBoard of toValidate) {
    const board = normalizeBoard(rawBoard);
    if (!VALID_BOARD_TYPES.has(board.board_type)) failures.push(`invalid board type: ${board.board_type}`);
    if (!normalizeId(board.board_id)) failures.push("invalid board id");

    const seen = new Set();
    for (const entry of materializeLatestEntries(board.entries || [])) {
      if (!entry.id) {
        failures.push("entry id missing");
        continue;
      }
      if (seen.has(entry.id)) failures.push(`duplicate entry id: ${entry.id}`);
      seen.add(entry.id);

      if (!VALID_ENTRY_TYPES.has(entry.entry_type)) failures.push(`invalid entry type: ${entry.entry_type}`);
      if (!VALID_ENTRY_STATUSES.has(entry.status)) failures.push(`invalid entry status: ${entry.status}`);
      if (entry.board_id !== board.board_id) failures.push(`entry board mismatch: ${entry.id}`);
      if (!entry.summary) failures.push(`empty entry summary: ${entry.id}`);
    }
  }

  return {
    repositoryRoot,
    generated_at: nowIso(),
    valid: failures.length === 0,
    failures,
    board_count: toValidate.length,
    entry_count: toValidate.reduce((sum, row) => sum + (row.entries?.length || 0), 0),
  };
}

function createBoardFromFindingsPayload(payload = {}) {
  const repositoryRoot = path.resolve(payload.repositoryRoot || process.cwd());
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const repository = nowTrimmed(payload.repository || payload.repo || ".");
  const boardType = normalizeBoardType(payload.boardType || "repository-board");
  const boardId = normalizeId(payload.boardId || payload.taskId || repository || "repository-board");
  const actor = nowTrimmed(payload.actor || "system");

  const boardResult = createBoard({
    repositoryRoot,
    boardType,
    boardId,
    repository,
    actor,
    relatedTasks: parseList(payload.relatedTasks || payload.taskIds),
    status: "active",
    reason: "findings sync",
  });
  const created = [];

  for (const finding of findings) {
    const result = createEntry(boardId, {
      board_type: boardType,
      board_id: boardId,
      id: normalizeId(`finding-${finding.id || hash(JSON.stringify(finding)).slice(0, 10)}`),
      entry_type: "finding",
      status: "open",
      author_role: actor,
      summary: `${finding.repository || repository}: ${nowTrimmed(finding.rule || finding.id || "finding")}`,
      details: nowTrimmed(finding.message || finding.recommendation || ""),
      related_tasks: dedupe((finding.relatedTasks || finding.tasks || []).concat(payload.relatedTasks || [])),
      related_files: parseList([finding.file]),
      related_symbols: parseList([finding.symbol || finding.function]),
      related_findings: parseList([finding.id]),
      metadata: {
        source: finding.source || "static-analysis",
        severity: finding.severity || "info",
        category: finding.category || "general",
      },
    }, {
      repositoryRoot,
      boardType,
      actor,
    });
    created.push(result.entry);
  }

  return {
    board_id: boardId,
    board_type: boardType,
    created: created.length,
    entries: created,
    created_board: boardResult.created,
  };
}

function createBoardFromTaskReference(taskId, options = {}) {
  return createBoard({
    ...options,
    boardType: "task-board",
    boardId: normalizeId(taskId),
  });
}

function summarizeForTask(taskId, repositoryRoot, options = {}) {
  return searchBoards(repositoryRoot, { ...options, query: taskId, boardType: "task-board", limit: 100 });
}

function listEntries(repositoryRoot, options = {}) {
  return collectBoardEntries(repositoryRoot, options);
}

function collectBoardRecords(repositoryRoot, options = {}) {
  return collectBoardEntries(repositoryRoot, options);
}

module.exports = {
  createBoard,
  createEntry,
  updateEntry,
  resolveEntry,
  searchBoards,
  summarizeBoard,
  summarizeAllBoards,
  archiveBoard,
  validateBoard,
  collectBoardEntries,
  collectBoardRecords,
  listBoards,
  loadBoards: collectBoards,
  listEntries,
  createBoardFromFindingsPayload,
  createBoardFromTaskReference,
  summarizeForTask,
  findBoardById,
};
