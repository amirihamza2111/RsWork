// Tiny in-memory TTL cache for hot public reads (menu browsing). Single-node
// only — swap for Redis when scaling horizontally. Writers bust by prefix so
// manager edits are visible immediately.
const store = new Map();

const get = (key) => {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.exp) {
    store.delete(key);
    return undefined;
  }
  return entry.val;
};

const set = (key, val, ttlMs = 15_000) => {
  store.set(key, { val, exp: Date.now() + ttlMs });
};

const delPrefix = (prefix) => {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
};

module.exports = { get, set, delPrefix };
