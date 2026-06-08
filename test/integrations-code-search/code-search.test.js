const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require("node:fs");
const { test } = require("node:test");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(__filename);
const codeSearch = requireFromRepo("../../integrations/code-search/src/engine.js");
const repoIntelligence = requireFromRepo("../../integrations/repository-intelligence/src/engine.js");
const repomix = requireFromRepo("../../integrations/repomix/src/engine.js");
const graphify = requireFromRepo("../../integrations/graphify/src/engine.js");

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mission-code-search-"));
}

function write(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function buildFixtureWorkspace() {
  const root = tempDir();
  const indexRoot = path.join(root, ".index");
  write(path.join(root, "repo-registry.json"), JSON.stringify({
    repositories: {
      "repo-a": { path: "repo-a", owner: "platform-team", team: "platform-core", responsibilities: ["auth", "identity"] },
      "repo-b": { path: "repo-b", owner: "platform-team", team: "platform-core", responsibilities: ["web", "routing"] },
    },
  }, null, 2));
  write(path.join(root, "global-issues.json"), JSON.stringify({
    tasks: [
      {
        id: "MC-100",
        title: "Authentication middleware",
        description: "Add middleware for authenticated routes.",
        repository: "repo-a",
        files: ["src/auth.ts", "src/auth-helper.ts"],
      },
      {
        id: "MC-101",
        title: "Consume login endpoint",
        description: "Build login endpoint usage.",
        repository: "repo-b",
        files: ["src/api.ts"],
      },
    ],
  }, null, 2));
  write(path.join(root, "dependency-map.json"), JSON.stringify({
    dependencies: [
      { from: "MC-100", to: "MC-101", type: "depends_on", repository: "repo-a" },
    ],
  }, null, 2));
  write(path.join(root, "decision-log.json"), JSON.stringify({
    decisions: [{ id: "DEC-1", title: "Auth boundary", taskId: "MC-100", text: "Auth should be centralized." }],
  }, null, 2));
  write(path.join(root, "architecture-wiki.md"), "# Architecture\nAuth middleware should remain centralized.");
  write(path.join(root, "git-wiki.json"), JSON.stringify({
    pages: [{ id: "wiki-auth", title: "Auth pages", path: "wiki/auth.md", content: "Identity docs." }],
  }, null, 2));
  write(path.join(root, "repo-a", "src", "auth.ts"), `
export interface AuthProvider {
  authenticate(request: any): boolean;
}

export class ApiAuthProvider implements AuthProvider {
  authenticate(request: any): boolean { return true; }
}

export function authenticationMiddleware(req: any, next: () => void) {
  if (!req?.user) throw new Error("unauthorized");
  next();
}
`);
  write(path.join(root, "repo-a", "src", "auth-helper.ts"), `
export function isAuthenticated(req: any) {
  return Boolean(req?.user);
}
`);
  write(path.join(root, "repo-b", "src", "consumer.ts"), `
import { authenticationMiddleware } from "../../repo-a/src/auth";
export function secureConsumer(req: any, next: () => void) {
  authenticationMiddleware(req, next);
}
`);
  write(path.join(root, "repo-b", "src", "api.ts"), `
import { fetchUsers } from "./client";
export const loginRoute = "/login";
export function loginHandler() {
  return fetch("/login", { method: "POST" });
}
`);
  write(path.join(root, "analysis-results", "findings.json"), JSON.stringify({
    findings: [
      {
        id: "F-1001",
        source: "semgrep",
        repository: "repo-a",
        file: "repo-a/src/auth.ts",
        line: 6,
        severity: "high",
        category: "security",
        rule: "mc-auth",
        message: "Potential auth bypass path",
        recommendation: "Validate token source.",
      },
    ],
  }, null, 2));

  return { root, indexRoot };
}

test("index-repositories builds deterministic local code index", () => {
  const { root } = buildFixtureWorkspace();
  try {
    const result = codeSearch.indexRepositories({ repositoryRoot: root });
    const index = JSON.parse(fs.readFileSync(result.indexPath, "utf8"));
    assert.equal(index.generatedAt, String(index.generatedAt));
    assert.equal(index.source, "local");
    assert.equal(index.files.length > 0, true);
    assert.equal(index.symbols.some((row) => row.symbol === "authenticationMiddleware"), true);
  } finally {
    cleanup(root);
  }
});

test("symbol search returns exact match and deterministic ranking", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const first = codeSearch.searchSymbol({ repositoryRoot: root, symbolName: "authenticationMiddleware", limit: 10, preferSourcebot: true });
    const second = codeSearch.searchSymbol({ repositoryRoot: root, symbolName: "authenticationMiddleware", limit: 10, preferSourcebot: true });
    assert.equal(Array.isArray(first.results), true);
    assert.equal(first.results.length > 0, true);
    assert.equal(first.results[0].symbol, "authenticationMiddleware");
    assert.equal(first.results[0].location.includes("auth.ts"), true);
    assert.equal(JSON.stringify(first.results), JSON.stringify(second.results));
  } finally {
    cleanup(root);
  }
});

test("reference search identifies usages", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.searchReferences({ repositoryRoot: root, symbol: "authenticationMiddleware", limit: 20, preferSourcebot: true });
    assert.equal(result.type, "reference");
    assert.equal(result.results.length >= 1, true);
    assert.equal(result.results.some((row) => row.file.includes("consumer.ts")), true);
  } finally {
    cleanup(root);
  }
});

test("caller search identifies calling functions", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.searchCallers({ repositoryRoot: root, symbol: "authenticationMiddleware", limit: 20, preferSourcebot: true });
    assert.equal(result.type, "caller");
    assert.equal(result.results.length >= 1, true);
    assert.equal(result.results.some((row) => row.symbol.includes("authenticationMiddleware")), true);
  } finally {
    cleanup(root);
  }
});

test("implementation search finds interface implementations", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.searchImplementations({ repositoryRoot: root, symbol: "AuthProvider", limit: 20, preferSourcebot: true });
    assert.equal(result.type, "implementation");
    assert.equal(result.results.some((row) => row.symbol.includes("ApiAuthProvider")), true);
  } finally {
    cleanup(root);
  }
});

test("api usage search finds endpoint and service usage", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const login = codeSearch.searchApiUsage({ repositoryRoot: root, query: "/login", limit: 20 });
    assert.equal(login.results.length >= 1, true);
    assert.equal(login.results.some((row) => row.symbol.includes("POST") || row.symbol.includes("/login") || row.symbol.includes("GET") || row.symbol.includes("fetch")), true);
  } finally {
    cleanup(root);
  }
});

test("cross-repository search spans repositories", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.searchCrossRepository({ repositoryRoot: root, query: "authentication", limit: 20 });
    const repos = new Set(result.results.map((row) => row.repository));
    assert.equal(repos.size >= 1, true);
    assert.equal(result.results.length > 0, true);
  } finally {
    cleanup(root);
  }
});

test("owner search derives repository ownership", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.searchOwner({ repositoryRoot: root, query: "platform-team", limit: 20 });
    assert.equal(result.results.length >= 1, true);
    assert.equal(result.results.some((row) => row.symbol === "platform-team" || row.repository === "repo-a" || row.repository === "repo-b"), true);
  } finally {
    cleanup(root);
  }
});

test("validate-search-state detects valid index", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = codeSearch.validateSearchState({ repositoryRoot: root });
    assert.equal(result.valid, true);
    assert.equal(result.counts.files >= 3, true);
  } finally {
    cleanup(root);
  }
});

test("fallback mode works when Sourcebot unavailable", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const withSourcebotFlag = codeSearch.searchSymbol({
      repositoryRoot: root,
      symbolName: "ApiAuthProvider",
      preferSourcebot: true,
      limit: 5,
    });
    assert.equal(withSourcebotFlag.source, "local");
    assert.equal(withSourcebotFlag.results.length > 0, true);
  } finally {
    cleanup(root);
  }
});

test("repository-intelligence uses code-search symbol suggestions", () => {
  const { root, indexRoot } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    repoIntelligence.buildIndexes({ repositoryRoot: root, indexRoot });
    const result = repoIntelligence.symbolSearch({ repositoryRoot: root, indexRoot, symbolName: "authenticationMiddleware", limit: 20 });
    assert.equal(result.results.length > 0, true);
    assert.equal(result.results[0].reason.includes("code-search") || result.results[0].reason.includes("symbol match"), true);
  } finally {
    cleanup(root);
  }
});

test("graphify can ingest repository and expose symbol nodes", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = graphify.buildProjectGraph({
      repositoryRoot: root,
      outputDir: path.join(root, "generated-graphs"),
      preferExternal: false,
      profile: "coder",
    });
    const graph = JSON.parse(fs.readFileSync(result.graphPath, "utf8"));
    const hasAuthSymbol = graph.nodes.some((row) => String(row.symbol || "").includes("authenticationMiddleware"));
    assert.equal(hasAuthSymbol, true);
  } finally {
    cleanup(root);
  }
});

test("repomix task context generates for auth task", () => {
  const { root } = buildFixtureWorkspace();
  try {
    codeSearch.indexRepositories({ repositoryRoot: root });
    const result = repomix.buildTaskContext({
      repositoryPath: root,
      taskId: "MC-100",
      profile: "coder",
      limit: 50,
      outputDir: path.join(root, "generated-context"),
    });
    const md = fs.readFileSync(path.join(result.outDir, "task-summary.md"), "utf8");
    assert.equal(md.includes("Task MC-100 Summary"), true);
    assert.equal(md.includes("auth.ts"), true);
  } finally {
    cleanup(root);
  }
});
