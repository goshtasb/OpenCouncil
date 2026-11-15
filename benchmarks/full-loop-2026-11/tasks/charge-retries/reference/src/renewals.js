'use strict';
const { chargeCustomer } = require('./billing');

/**
 * Renews every due subscription for its next period. A subscription is due while its
 * currentPeriodEnd has passed. A failed renewal is recorded and the subscription stays due, so
 * tomorrow's run tries it again; after 4 failed days it is cancelled by the dunning job.
 */
async function renewDue(gateway, subscriptions, now = Date.now(), log = () => {}) {
  const results = [];
  for (const sub of subscriptions) {
    if (sub.currentPeriodEnd > now) continue;
    try {
      // One key per subscription period: a renewal retried by tomorrow's run reuses it, so a charge that
      // went through behind a timeout is returned instead of made twice (see docs/gateway.md).
      const charge = await chargeCustomer(gateway, sub.customer, sub.priceCents, { idempotencyKey: `renewal:${sub.id}:${sub.currentPeriodEnd}` });
      sub.currentPeriodEnd += sub.periodMs;
      results.push({ id: sub.id, ok: true, chargeId: charge.id });
    } catch (err) {
      log(`renewal ${sub.id} failed: ${err.name}`);
      results.push({ id: sub.id, ok: false, error: err.name });
    }
  }
  return results;
}

module.exports = { renewDue };
