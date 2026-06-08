const crypto = require("node:crypto");

function embedText(text, dimension = 64) {
  const vector = Array.from({ length: dimension }, () => 0);
  const normalized = String(text || "").toLowerCase();
  for (const token of normalized.match(/[a-z0-9_.$]+/g) || []) {
    for (const ch of token) {
      const idx = ch.charCodeAt(0) % dimension;
      vector[idx] += 1;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function createProvider() {
  return { name: "local", embedText };
}

module.exports = { createProvider, embedText };
