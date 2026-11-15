'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKv } = require('../src/kv');
const { balance, spendCredit } = require('../src/wallet');

test('spends credit once even when two checkouts race', async () => {
  const kv = createKv({ 'wallet:u1': { cents: 1000 } });
  const [a, b] = await Promise.all([spendCredit(kv, 'u1', 800), spendCredit(kv, 'u1', 800)]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  assert.equal(await balance(kv, 'u1'), 200);
});
