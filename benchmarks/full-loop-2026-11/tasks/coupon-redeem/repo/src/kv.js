'use strict';

const tick = () => new Promise(resolve => setImmediate(resolve));

/**
 * Key-value store client. Same interface as the Redis-backed one in production: every call is a network
 * round trip, so other requests can run between a get and a set.
 */
function createKv(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  const queues = new Map();
  return {
    async get(key) { await tick(); const v = data.get(key); return v === undefined ? null : structuredClone(v); },
    async set(key, value) { await tick(); data.set(key, structuredClone(value)); },
    async del(key) { await tick(); data.delete(key); },
    /**
     * Atomic read-modify-write on one key (a Lua script in production). `fn` gets the current value
     * (or null) and returns the new one; return undefined to leave it unchanged. Resolves to what `fn`
     * returned. Calls on the same key run one at a time.
     */
    async update(key, fn) {
      const prev = queues.get(key) || Promise.resolve();
      const run = prev.then(async () => {
        await tick();
        const cur = data.has(key) ? structuredClone(data.get(key)) : null;
        const next = fn(cur);
        if (next !== undefined) data.set(key, structuredClone(next));
        return next;
      });
      queues.set(key, run.catch(() => {}));
      return run;
    }
  };
}

module.exports = { createKv };
