'use strict';

/** Usage queries for the customer dashboard. */

async function totalUsage(store, accountId, { from, to } = {}) {
  const events = await store.usageEvents(accountId, { from, to });
  return events.reduce((sum, e) => sum + e.units, 0);
}

module.exports = { totalUsage };
