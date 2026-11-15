'use strict';

/**
 * Coupons live at `coupon:<CODE>`:
 *   { code, percentOff, maxUses, uses, perUser, expiresAt }
 * Marketing creates them in the admin tool. A null maxUses or perUser means no limit.
 */

async function getCoupon(kv, code) {
  return kv.get(`coupon:${String(code).trim().toUpperCase()}`);
}

/** Preview for the cart page: what the coupon would take off, without using it up. */
async function previewCoupon(kv, code, cartCents, now = Date.now()) {
  const c = await getCoupon(kv, code);
  if (!c) return { ok: false, reason: 'unknown_code' };
  if (c.expiresAt != null && now >= c.expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, discountCents: Math.round((cartCents * c.percentOff) / 100) };
}

module.exports = { getCoupon, previewCoupon };
