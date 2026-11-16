'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKv } = require('../src/kv');
const { previewCoupon } = require('../src/coupons');
const { NOW, coupons } = require('./fixtures');

test('previews a discount', async () => {
  const kv = createKv(coupons);
  assert.deepEqual(await previewCoupon(kv, 'welcome10', 5000, NOW), { ok: true, discountCents: 500 });
});

test('rejects unknown and expired codes', async () => {
  const kv = createKv(coupons);
  assert.equal((await previewCoupon(kv, 'NOPE', 5000, NOW)).reason, 'unknown_code');
  assert.equal((await previewCoupon(kv, 'SUMMER25', 5000, NOW)).reason, 'expired');
});
