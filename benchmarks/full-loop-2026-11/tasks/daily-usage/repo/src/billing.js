'use strict';
const { localDay } = require('./time');
const { accountTimeZone } = require('./accounts');

const PRICE_PER_UNIT_CENTS = 2;
// `synthetic_probe` events are our own uptime checks against the customer's endpoint, not their usage.
const BILLABLE_METRICS = new Set(['api_calls', 'storage_gb', 'build_minutes']);

const billable = events => events.filter(e => BILLABLE_METRICS.has(e.metric));

/** Billable amount for a set of usage events. Every billable metric bills by units. */
function usageCharge(events) {
  return billable(events).reduce((sum, e) => sum + e.units, 0) * PRICE_PER_UNIT_CENTS;
}

/**
 * Charge per day for the invoice breakdown, in the account's time zone so it matches the
 * customer's own calendar. Only days with usage appear.
 */
function dailyTotals(events, account) {
  const timeZone = accountTimeZone(account);
  const byDay = new Map();
  for (const e of billable(events)) {
    const day = localDay(e.at, timeZone);
    byDay.set(day, (byDay.get(day) || 0) + e.units * PRICE_PER_UNIT_CENTS);
  }
  return [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, total]) => ({ day, total }));
}

module.exports = { usageCharge, dailyTotals, PRICE_PER_UNIT_CENTS, BILLABLE_METRICS };
