'use strict';
const { localDay } = require('./time');
const { accountTimeZone } = require('./accounts');
const { BILLABLE_METRICS } = require('./billing');

/** Usage queries for the customer dashboard. */

async function totalUsage(store, accountId, { from, to } = {}) {
  const events = await store.usageEvents(accountId, { from, to });
  return events.reduce((sum, e) => sum + e.units, 0);
}

/**
 * Billable units per calendar day (raw events plus daily rollups) in the account's time zone, for the last `days` days ending today,
 * oldest first, with zero for days without usage. Days are stepped on the calendar, not by 24 hours,
 * so daylight saving changes don't skip or repeat a day.
 */
async function dailyUsage(store, accountId, days, now = Date.now()) {
  const tz = accountTimeZone(await store.getAccount(accountId));
  const [y, m, d] = localDay(now, tz).split('-').map(Number);
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  const totals = new Map(dayList.map(day => [day, 0]));
  // A local day is at most 26 hours from UTC midnight; fetch with a margin and bucket precisely.
  const from = Date.UTC(y, m - 1, d - days, -14);
  for (const e of await store.usageEvents(accountId, { from, to: now + 1 })) {
    if (!BILLABLE_METRICS.has(e.metric)) continue;
    const day = localDay(e.at, tz);
    if (totals.has(day)) totals.set(day, totals.get(day) + e.units);
  }
  // Older days live in the daily rollups (already in the account's local days); raw events that were
  // folded into a rollup are deleted, so the two never count the same usage twice.
  for (const r of await store.usageRollups(accountId, { fromDay: dayList[0], toDay: dayList[dayList.length - 1] })) {
    if (BILLABLE_METRICS.has(r.metric) && totals.has(r.day)) totals.set(r.day, totals.get(r.day) + r.units);
  }
  return dayList.map(day => ({ day, units: totals.get(day) }));
}

module.exports = { totalUsage, dailyUsage };
