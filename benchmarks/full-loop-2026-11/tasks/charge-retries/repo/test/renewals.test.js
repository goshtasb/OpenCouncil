'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../src/gateway');
const { renewDue } = require('../src/renewals');
const { fakeTransport } = require('./fake-transport');

test('records each renewal', async () => {
  const MONTH = 30 * 24 * 3600 * 1000, NOW = Date.UTC(2026, 3, 1);
  const subs = [
    { id: 's1', customer: { id: 'c1' }, priceCents: 900, periodMs: MONTH, currentPeriodEnd: NOW - 1000 },
    { id: 's2', customer: { id: 'c2' }, priceCents: 900, periodMs: MONTH, currentPeriodEnd: NOW - 1000 },
    { id: 's3', customer: { id: 'c3' }, priceCents: 900, periodMs: MONTH, currentPeriodEnd: NOW + 1000 }
  ];
  const out = await renewDue(new GatewayClient(fakeTransport(['ok', 'decline'])), subs, NOW);
  assert.deepEqual(out.map(r => r.ok), [true, false]);
  assert.equal(subs[0].currentPeriodEnd, NOW - 1000 + MONTH);
  assert.equal(subs[1].currentPeriodEnd, NOW - 1000);
});
