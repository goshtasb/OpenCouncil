'use strict';

/** In-memory invoice store; production swaps in the Postgres one with the same interface. */
function createStore(invoices = []) {
  const byId = new Map(invoices.map(inv => [inv.id, structuredClone(inv)]));
  return {
    async all() { return [...byId.values()].map(inv => structuredClone(inv)); },
    async get(id) { const inv = byId.get(id); return inv && structuredClone(inv); },
    async save(inv) { byId.set(inv.id, structuredClone(inv)); }
  };
}

module.exports = { createStore };
