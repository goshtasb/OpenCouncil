'use strict';

/**
 * Coupons live at `coupon:<CODE>`:
 *   { code, percentOff, maxUses, uses, perUser, expiresAt }
 * Marketing creates them in the admin tool. A null maxUses or perUser means no limit.
 */

// The old admin tool saved expiresAt in ms, the new one (Oct 2026 on) as an ISO string; null means never.
const expiryMs = c => (c.expiresAt == null ? null : typeof c.expiresAt === 'number' ? c.expiresAt : Date.parse(c.expiresAt));
const isExpired = (c, now) => { const t = expiryMs(c); return t != null && (Number.isNaN(t) || now >= t); };

const keyFor = code => `coupon:${String(code).trim().toUpperCase()}`;

async function getCoupon(kv, code) {
  return kv.get(keyFor(code));
}

/** Preview for the cart page: what the coupon would take off, without using it up. */
async function previewCoupon(kv, code, cartCents, now = Date.now()) {
  const c = await getCoupon(kv, code);
  if (!c) return { ok: false, reason: 'unknown_code' };
  if (isExpired(c, now)) return { ok: false, reason: 'expired' };
  return { ok: true, discountCents: Math.round((cartCents * c.percentOff) / 100) };
}

/**
 * Uses up one redemption when an order is placed. The check and the increment happen in one atomic
 * update on the coupon key, so concurrent checkouts can't go over maxUses or perUser.
 */
async function redeemCoupon(kv, code, userId, now = Date.now()) {
  let outcome = { ok: false, reason: 'unknown_code' };
  await kv.update(keyFor(code), c => {
    if (!c) { outcome = { ok: false, reason: 'unknown_code' }; return undefined; }
    if (isExpired(c, now)) { outcome = { ok: false, reason: 'expired' }; return undefined; }
    if (c.maxUses != null && c.uses >= c.maxUses) { outcome = { ok: false, reason: 'used_up' }; return undefined; }
    const byUser = c.redeemedBy || {};
    const mine = byUser[userId] || 0;
    if (c.perUser != null && mine >= c.perUser) { outcome = { ok: false, reason: 'already_used' }; return undefined; }
    outcome = { ok: true, percentOff: c.percentOff };
    return { ...c, uses: c.uses + 1, redeemedBy: { ...byUser, [userId]: mine + 1 } };
  });
  return outcome;
}

module.exports = { getCoupon, previewCoupon, redeemCoupon };
