'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { usageCharge, dailyTotals } = require('../src/billing');

const events = [
  { accountId: 'a1', at: Date.UTC(2026, 0, 5, 12), units: 10, metric: 'api_calls' },
  { accountId: 'a1', at: Date.UTC(2026, 0, 5, 13), units: 5, metric: 'api_calls' },
  { accountId: 'a1', at: Date.UTC(2026, 0, 5, 14), units: 60, metric: 'synthetic_probe' },
  { accountId: 'a1', at: Date.UTC(2026, 0, 7, 1), units: 1, metric: 'storage_gb' }
];

test('charges billable units', () => {
  assert.equal(usageCharge(events), 32);
});

test('totals per day in the account time zone', () => {
  assert.deepEqual(dailyTotals(events, { id: 'a1', timezone: 'UTC' }), [{ day: '2026-01-05', total: 30 }, { day: '2026-01-07', total: 2 }]);
  assert.deepEqual(dailyTotals(events, { id: 'a1', region: 'us-east' }), [{ day: '2026-01-05', total: 30 }, { day: '2026-01-06', total: 2 }]);
});
