'use strict';

/** Store credit. Results use the shop's { ok, reason } convention instead of throwing for expected failures. */

async function balance(kv, userId) {
  const w = await kv.get(`wallet:${userId}`);
  return w ? w.cents : 0;
}

async function spendCredit(kv, userId, cents) {
  let outcome;
  await kv.update(`wallet:${userId}`, w => {
    const have = w ? w.cents : 0;
    if (have < cents) { outcome = { ok: false, reason: 'insufficient_credit' }; return undefined; }
    outcome = { ok: true, remaining: have - cents };
    return { cents: have - cents };
  });
  return outcome;
}

module.exports = { balance, spendCredit };
