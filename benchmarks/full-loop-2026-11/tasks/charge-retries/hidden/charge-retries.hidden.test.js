'use strict';
// Hidden answer key for the charge-retries task. Copied into test/ at scoring time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../src/gateway');
const { chargeCustomer } = require('../src/billing');
const { CardDeclinedError, GatewayTimeoutError } = require('../src/errors');

// Behaves like docs/gateway.md: dedupes on Idempotency-Key; a scripted timeout can happen after the charge is made.
function dedupingGateway(script) {
  const byKey = new Map();
  const charges = [];
  const sends = [];
  let n = 1;
  return {
    charges, sends,
    async send(method, path, body, headers) {
      const key = headers && headers['Idempotency-Key'];
      sends.push(key);
      const step = script.length ? script.shift() : 'ok';
      if (step === 'timeout-before') { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; throw e; }
      if (step === 'decline') return { status: 402, body: { message: 'declined', code: 'do_not_honor' } };
      let charge = key && byKey.get(key);
      if (!charge) {
        charge = { id: `ch_h${n++}`, amount: body.amount, customer: body.customer };
        charges.push(charge);
        if (key) byKey.set(key, charge);
      }
      if (step === 'timeout-after') { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; throw e; }
      return { status: 201, body: charge };
    }
  };
}

test('hidden: a timeout after the gateway made the charge does not charge twice', { timeout: 30000 }, async () => {
  const gw = dedupingGateway(['timeout-after', 'ok']);
  const charge = await chargeCustomer(new GatewayClient(gw), { id: 'cus_9' }, 2500);
  assert.equal(gw.charges.length, 1, `expected 1 charge, gateway made ${gw.charges.length}`);
  assert.equal(charge.id, gw.charges[0].id);
});

test('hidden: a decline is not retried', { timeout: 30000 }, async () => {
  const gw = dedupingGateway(['decline', 'ok', 'ok', 'ok']);
  await assert.rejects(chargeCustomer(new GatewayClient(gw), { id: 'cus_9' }, 2500), CardDeclinedError);
  assert.equal(gw.sends.length, 1, `declined card was sent ${gw.sends.length} times`);
});

test('hidden: gives up after at most 3 retries and still reports a timeout', { timeout: 30000 }, async () => {
  const gw = dedupingGateway(Array(10).fill('timeout-before'));
  await assert.rejects(chargeCustomer(new GatewayClient(gw), { id: 'cus_9' }, 2500), GatewayTimeoutError);
  assert.ok(gw.sends.length >= 2 && gw.sends.length <= 4, `expected 2 to 4 attempts, got ${gw.sends.length}`);
});

test('hidden: two separate purchases of the same amount are two charges', { timeout: 30000 }, async () => {
  const gw = dedupingGateway([]);
  const client = new GatewayClient(gw);
  await chargeCustomer(client, { id: 'cus_9' }, 2500);
  await chargeCustomer(client, { id: 'cus_9' }, 2500);
  assert.equal(gw.charges.length, 2, `expected 2 charges, gateway made ${gw.charges.length}`);
});

test("hidden: a renewal that timed out after charging is not charged again by tomorrow's run", { timeout: 30000 }, async () => {
  const { renewDue } = require('../src/renewals');
  const DAY = 24 * 3600 * 1000, NOW = Date.UTC(2026, 3, 1, 3);
  const sub = { id: 'sub_h', customer: { id: 'cus_h' }, priceCents: 1200, periodMs: 30 * DAY, currentPeriodEnd: NOW - 1000 };
  // Day 1: every attempt reaches the gateway, which charges, but the answer never comes back.
  const script = Array(10).fill('timeout-after');
  const gw = dedupingGateway(script);
  const client = new GatewayClient(gw);
  const day1 = await renewDue(client, [sub], NOW);
  assert.equal(day1[0].ok, false);
  // Day 2: the gateway answers again; the subscription is still due.
  script.length = 0;
  const day2 = await renewDue(client, [sub], NOW + DAY);
  assert.equal(day2[0].ok, true);
  assert.equal(gw.charges.length, 1, `customer was charged ${gw.charges.length} times for one renewal`);
});

test('hidden: consecutive renewal periods are separate charges', { timeout: 30000 }, async () => {
  const { renewDue } = require('../src/renewals');
  const DAY = 24 * 3600 * 1000, NOW = Date.UTC(2026, 3, 1, 3);
  const sub = { id: 'sub_h2', customer: { id: 'cus_h' }, priceCents: 1200, periodMs: 30 * DAY, currentPeriodEnd: NOW - 1000 };
  const gw = dedupingGateway([]);
  const client = new GatewayClient(gw);
  await renewDue(client, [sub], NOW);
  await renewDue(client, [sub], NOW + 31 * DAY);
  assert.equal(gw.charges.length, 2);
});
