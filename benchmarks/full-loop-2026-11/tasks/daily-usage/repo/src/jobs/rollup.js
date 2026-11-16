'use strict';
const { localDay } = require('../time');
const { accountTimeZone } = require('../accounts');

/**
 * Folds raw usage events older than the retention window into per-day rollups, in the account's time
 * zone, one row per day and metric. Production runs this nightly and then deletes the folded events.
 */
function rollupEvents(account, events) {
  const tz = accountTimeZone(account);
  const rows = new Map();
  for (const e of events) {
    const day = localDay(e.at, tz);
    const key = `${day}|${e.metric}`;
    const row = rows.get(key) || { accountId: account.id, day, metric: e.metric, units: 0 };
    row.units += e.units;
    rows.set(key, row);
  }
  return [...rows.values()];
}

module.exports = { rollupEvents };
