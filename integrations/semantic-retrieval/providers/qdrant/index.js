const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(process.cwd(), ".mission-control-semantic-qdrant");

function loadCollection(collection, basePath) {
  const file = path.join(basePath, `${collection}.json`);
  if (!fs.existsSync(file)) {
    return { collection, records: [], dimension: 64 };
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveCollection(basePath, collection, payload) {
  fs.mkdirSync(basePath, { recursive: true });
  const file = path.join(basePath, `${collection}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i += 1) {
    const left = Number(a[i] || 0);
    const right = Number(b[i] || 0);
    dot += left * right;
    magA += left * left;
    magB += right * right;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function createProvider(cfg = {}) {
  const collection = cfg.collection || "mission-control-semantic";
  const basePath = ROOT;
  const provider = {
    enabled: true,
    name: "qdrant-mock",
    hasCollection() {
      return fs.existsSync(path.join(basePath, `${collection}.json`));
    },
    rebuild({ collection: target = collection, records }) {
      const payload = { collection: target, records: Array.isArray(records) ? records : [], generated_at: new Date().toISOString() };
      saveCollection(basePath, target, payload);
      return payload;
    },
    upsertVectors({ collection: target = collection, records }) {
      const current = loadCollection(target, basePath);
      const merged = new Map();
      for (const row of current.records || []) merged.set(row.id, row);
      for (const row of Array.isArray(records) ? records : []) merged.set(row.id, row);
      const payload = { ...current, collection: target, records: Array.from(merged.values()) };
      saveCollection(basePath, target, payload);
      return payload;
    },
    deleteStale({ collection: target = collection, validIds }) {
      const current = loadCollection(target, basePath);
      const valid = validIds instanceof Set ? validIds : new Set(Array.isArray(validIds) ? validIds : []);
      const next = (current.records || []).filter((row) => valid.has(row.id));
      const payload = { ...current, collection: target, records: next };
      saveCollection(basePath, target, payload);
      return payload;
    },
    search({ collection: target = collection, vector, limit = 12, filter = {} }) {
      const current = loadCollection(target, basePath);
      const rows = [];
      for (const row of current.records || []) {
        if (filter.source_types && filter.source_types.length > 0 && !filter.source_types.includes(row.source_type)) {
          continue;
        }
        const sourceMatch = !filter.repository || filter.repository === row.repository;
        const taskMatch = !filter.task_id || row.task_id === filter.task_id;
        if (!sourceMatch || !taskMatch) continue;
        rows.push({ ...row, score: cosine(row.vector || [], vector || []) });
      }
      rows.sort((a, b) => b.score - a.score);
      return rows.slice(0, limit);
    },
    exportCollectionMetadata({ collection: target = collection }) {
      const current = loadCollection(target, basePath);
      return {
        collection: target,
        count: Array.isArray(current.records) ? current.records.length : 0,
        generated_at: current.generated_at || null,
      };
    },
  };
  return provider;
}

module.exports = { createProvider };
