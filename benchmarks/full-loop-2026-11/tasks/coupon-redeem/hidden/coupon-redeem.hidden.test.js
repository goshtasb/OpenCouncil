'use strict';
// Hidden answer key for the coupon-redeem task. Copied into test/ at scoring time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKv } = require('../src/kv');
const coupons = require('../src/coupons');

const NOW = Date.UTC(2026, 10, 2, 9);
const fresh = (o = {}) => ({ code: 'HIDDEN5', percentOff: 15, maxUses: 5, uses: 0, perUser: 1, expiresAt: null, ...o });
const okOf = r => !!(r && r.ok);

test('hidden: 20 different users racing for a 5-use coupon get exactly 5 redemptions', async () => {
  const kv = createKv({ 'coupon:HIDDEN5': fresh() });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => coupons.redeemCoupon(kv, 'HIDDEN5', `u${i}`, NOW)));
  assert.equal(results.filter(okOf).length, 5, `${results.filter(okOf).length} of 20 succeeded`);
  assert.ok(results.filter(r => !okOf(r)).every(r => r && typeof r.reason === 'string'), 'failures should be { ok: false, reason }');
});

test('hidden: one user racing ten checkouts on a once-per-user coupon gets it once', async () => {
  const kv = createKv({ 'coupon:HIDDEN5': fresh({ maxUses: 100 }) });
  const results = await Promise.all(Array.from({ length: 10 }, () => coupons.redeemCoupon(kv, 'HIDDEN5', 'same_user', NOW)));
  assert.equal(results.filter(okOf).length, 1, `${results.filter(okOf).length} of 10 succeeded`);
});

test('hidden: per-user limit holds across separate orders, and a second user still can', async () => {
  const kv = createKv({ 'coupon:HIDDEN5': fresh({ maxUses: 100, perUser: 2 }) });
  const a = [];
  for (let i = 0; i < 3; i++) a.push(await coupons.redeemCoupon(kv, 'HIDDEN5', 'ua', NOW + i));
  assert.deepEqual(a.map(okOf), [true, true, false]);
  assert.ok(okOf(await coupons.redeemCoupon(kv, 'hidden5', 'ub', NOW)), 'codes are case-insensitive, as in previewCoupon');
});

test('hidden: expired and unknown codes are refused without throwing', async () => {
  const kv = createKv({ 'coupon:HIDDEN5': fresh({ expiresAt: NOW - 1000 }) });
  const expired = await coupons.redeemCoupon(kv, 'HIDDEN5', 'u1', NOW);
  assert.equal(okOf(expired), false);
  assert.equal(typeof expired.reason, 'string');
  const unknown = await coupons.redeemCoupon(kv, 'NOPE', 'u1', NOW);
  assert.equal(okOf(unknown), false);
});

test('hidden: a null limit means no limit', async () => {
  const kv = createKv({
    'coupon:STAFF20': { code: 'STAFF20', percentOff: 20, maxUses: null, uses: 93, perUser: null, expiresAt: null },
    'coupon:WELCOME10': { code: 'WELCOME10', percentOff: 10, maxUses: null, uses: 1412, perUser: 1, expiresAt: null }
  });
  const staff = [];
  for (let i = 0; i < 3; i++) staff.push(await coupons.redeemCoupon(kv, 'STAFF20', 'staff_1', NOW));
  assert.deepEqual(staff.map(okOf), [true, true, true], 'perUser null should not limit a user');
  assert.ok(okOf(await coupons.redeemCoupon(kv, 'WELCOME10', 'new_user', NOW)), 'maxUses null should not limit the coupon');
});

test('hidden: a coupon from the new admin tool (ISO date) expires too', async () => {
  const kv = createKv({ 'coupon:HALLOWEEN15': { code: 'HALLOWEEN15', percentOff: 15, maxUses: 300, uses: 41, perUser: 1, expiresAt: '2026-11-01T07:00:00.000Z' } });
  const late = await coupons.redeemCoupon(kv, 'HALLOWEEN15', 'u1', Date.parse('2026-11-01T07:00:01Z'));
  assert.equal(okOf(late), false, 'redeemed after its ISO expiry date');
  const inTime = await coupons.redeemCoupon(kv, 'HALLOWEEN15', 'u2', Date.parse('2026-10-31T12:00:00Z'));
  assert.equal(okOf(inTime), true);
});
