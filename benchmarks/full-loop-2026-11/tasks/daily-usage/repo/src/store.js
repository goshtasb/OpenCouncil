'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
// Raw usage events are kept for 7 days. The nightly rollup job then folds each account's events
// into one rollup per day (the account's local day) and deletes the raw events.
const RAW_RETENTION_DAYS = 7;

/**
 * In-memory store with the same async interface as the production one.
 * usage events: { accountId, at (ms since epoch), units, metric }
 * rollups:      { accountId, day: 'YYYY-MM-DD' (account's local day), metric, units }
 */
function createStore({ accounts = [], usage = [], rollups = [] } = {}) {
  return {
    async getAccount(id) { return accounts.find(a => a.id === id) || null; },
    /** Raw events only; anything older than RAW_RETENTION_DAYS is already in the rollups. */
    async usageEvents(accountId, { from = -Infinity, to = Infinity } = {}) {
      return usage.filter(u => u.accountId === accountId && u.at >= from && u.at < to);
    },
    /** Daily rollups with fromDay <= day <= toDay. */
    async usageRollups(accountId, { fromDay = '0000-00-00', toDay = '9999-99-99' } = {}) {
      return rollups.filter(r => r.accountId === accountId && r.day >= fromDay && r.day <= toDay);
    },
    async recordUsage(event) { usage.push(event); }
  };
}

module.exports = { createStore, RAW_RETENTION_DAYS, DAY_MS };
