const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require("node:fs");
const { test } = require("node:test");

const blackboard = require("../../integrations/blackboard/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "blackboard-"));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test("create-board creates deterministic board file and idempotent re-open", () => {
  const root = tempDir();
  try {
    const create = blackboard.createBoard({
      repositoryRoot: root,
      boardType: "task-board",
      boardId: "MC-123",
    });
    const repeat = blackboard.createBoard({
      repositoryRoot: root,
      boardType: "task-board",
      boardId: "MC-123",
    });

    assert.equal(create.created, true);
    assert.equal(repeat.created, false);
    assert.equal(repeat.board.board_id, "mc-123");
  } finally {
    cleanup(root);
  }
});

test("create-entry validates input and rejects duplicates", () => {
  const root = tempDir();
  try {
    blackboard.createBoard({
      repositoryRoot: root,
      boardType: "task-board",
      boardId: "MC-234",
    });
    const first = blackboard.createEntry("MC-234", {
      entry_type: "finding",
      summary: "Auth middleware uses raw headers",
      details: "Add strict parser checks",
    }, {
      repositoryRoot: root,
      boardType: "task-board",
      actor: "coder",
    });

    assert.equal(first.entry.board_id, "mc-234");
    let duplicateError = null;
    try {
      blackboard.createEntry("MC-234", {
        entry_type: "finding",
        summary: "Auth middleware uses raw headers",
        details: "duplicate payload",
        id: first.entry.id,
      }, {
        repositoryRoot: root,
        boardType: "task-board",
        actor: "coder",
      });
    } catch (error) {
      duplicateError = error;
    }
    assert.equal(duplicateError instanceof Error, true);
  } finally {
    cleanup(root);
  }
});

test("update-entry and resolve-entry keep history and latest status", () => {
  const root = tempDir();
  try {
    blackboard.createBoard({
      repositoryRoot: root,
      boardType: "review-board",
      boardId: "PR-11",
    });
    const created = blackboard.createEntry("PR-11", {
      entry_type: "finding",
      summary: "Potential SQL concat risk",
      details: "Investigate this path.",
    }, {
      repositoryRoot: root,
      boardType: "review-board",
    });
    const updated = blackboard.updateEntry("PR-11", created.entry.id, {
      status: "resolved",
      details: "Reviewed and fixed",
      actor: "reviewer",
      related_findings: ["F-1"],
    }, {
      repositoryRoot: root,
      boardType: "review-board",
      actor: "reviewer",
    });

    assert.equal(updated.entry.status, "resolved");
    assert.ok(updated.entry.history.length > 0);

    const resolved = blackboard.resolveEntry("PR-11", created.entry.id, {
      status: "resolved",
      details: "final",
      repositoryRoot: root,
      boardType: "review-board",
    });
    assert.equal(resolved.entry.status, "resolved");
  } finally {
    cleanup(root);
  }
});

test("search-board returns role-relevant rows", () => {
  const root = tempDir();
  try {
    blackboard.createBoard({
      repositoryRoot: root,
      boardType: "repository-board",
      boardId: "repo-a",
    });
    const created = blackboard.createEntry("repo-a", {
      entry_type: "decision",
      summary: "Use repository-scoped auth strategy",
      details: "Apply middleware pattern",
      related_tasks: ["MC-456"],
    }, {
      repositoryRoot: root,
      boardType: "repository-board",
    });
    const search = blackboard.searchBoards(root, {
      boardType: "repository-board",
      task: "MC-456",
      query: "auth",
      limit: 10,
    });
    assert.equal(search.total >= 2, true);
    assert.equal(search.results.some((row) => row.id === created.entry.id), true);
  } finally {
    cleanup(root);
  }
});

test("summarize-board writes machine and markdown artifacts", () => {
  const root = tempDir();
  const out = path.join(root, "generated-context");
  try {
    blackboard.createBoard({ repositoryRoot: root, boardType: "release-board", boardId: "R-1" });
    blackboard.createEntry("R-1", {
      entry_type: "risk",
      summary: "Release timing risk",
      details: "Coordinate feature flags",
    }, { repositoryRoot: root, boardType: "release-board" });
    blackboard.createEntry("R-1", {
      entry_type: "question",
      summary: "Are all migrations backward compatible?",
    }, { repositoryRoot: root, boardType: "release-board" });

    const result = blackboard.summarizeBoard("R-1", {
      repositoryRoot: root,
      boardType: "release-board",
      outputDir: out,
    });

    assert.equal(fs.existsSync(result.output.markdown), true);
    assert.equal(fs.existsSync(result.output.json), true);
    const md = fs.readFileSync(result.output.markdown, "utf8");
    assert.equal(md.includes("Open risks: 1"), true);
    assert.equal(md.includes("Release timing risk"), true);
  } finally {
    cleanup(root);
  }
});

test("validate-board detects malformed board state", () => {
  const root = tempDir();
  try {
    const invalidPath = path.join(root, "blackboard", "state", "task-board", "broken.json");
    mkdirSync(path.dirname(invalidPath), { recursive: true });
    writeFileSync(invalidPath, JSON.stringify({ invalid: true }, null, 2), "utf8");

    const result = blackboard.validateBoard({ repositoryRoot: root });
    assert.equal(result.valid, false);
    assert.equal(result.failures.length > 0, true);
  } finally {
    cleanup(root);
  }
});

test("createBoardFromFindingsPayload emits finding entries", () => {
  const root = tempDir();
  try {
    const result = blackboard.createBoardFromFindingsPayload({
      repositoryRoot: root,
      boardType: "repository-board",
      boardId: "repo-b",
      relatedTasks: ["MC-777"],
      findings: [
        {
          id: "F-100",
          repository: "repo-b",
          file: "src/auth.ts",
          line: 12,
          rule: "no-eval",
          message: "Avoid eval in auth parser.",
          severity: "high",
          source: "semgrep",
        },
      ],
    });

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].entry_type, "finding");
    assert.equal(result.entries[0].severity || result.entries[0].metadata?.severity, "high");
  } finally {
    cleanup(root);
  }
});
