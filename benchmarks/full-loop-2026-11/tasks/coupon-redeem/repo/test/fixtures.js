'use strict';
const NOW = Date.UTC(2026, 10, 1, 12);
const coupons = {
  'coupon:WELCOME10': { code: 'WELCOME10', percentOff: 10, maxUses: null, uses: 1412, perUser: 1, expiresAt: null },
  'coupon:STAFF20': { code: 'STAFF20', percentOff: 20, maxUses: null, uses: 93, perUser: null, expiresAt: null },
  'coupon:BLACKFRIDAY': { code: 'BLACKFRIDAY', percentOff: 30, maxUses: 500, uses: 0, perUser: 2, expiresAt: Date.UTC(2026, 10, 30) },
  // Made in the new admin tool (Oct 2026 on), which saves dates as ISO strings.
  'coupon:HALLOWEEN15': { code: 'HALLOWEEN15', percentOff: 15, maxUses: 300, uses: 41, perUser: 1, expiresAt: '2026-11-01T07:00:00.000Z' },
  'coupon:SUMMER25': { code: 'SUMMER25', percentOff: 25, maxUses: 200, uses: 200, perUser: 1, expiresAt: Date.UTC(2026, 8, 1) }
};
module.exports = { NOW, coupons };
