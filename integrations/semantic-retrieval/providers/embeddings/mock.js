function hashVector(text, dimension = 64) {
  const digest = require("node:crypto").createHash("md5").update(String(text || "")).digest();
  const vec = Array.from({ length: dimension }, () => 0);
  for (let i = 0; i < dimension; i += 1) {
    vec[i] = (digest[i % digest.length] / 255);
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => Number((value / norm).toFixed(6)));
}

function createProvider() {
  return { name: "mock", embedText: hashVector };
}

module.exports = { createProvider, hashVector };
