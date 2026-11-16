'use strict';
// Hidden answer key for the daily-usage task. Copied into test/ at scoring time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const usage = require('../src/usage');

// The amount on an entry, whatever the field is called: the one number on it other than the day.
function amount(entry) {
  const nums = Object.entries(entry).filter(([k, v]) => k !== 'day' && typeof v === 'number');
  assert.equal(nums.length, 1, `entry ${JSON.stringify(entry)} should have a day and one number`);
  return nums[0][1];
}
function dayOf(entry) {
  const d = entry.day ?? entry.date;
  assert.match(String(d), /^\d{4}-\d{2}-\d{2}$/, `entry ${JSON.stringify(entry)} has no YYYY-MM-DD day`);
  return d;
}

const accounts = [
  { id: 'acc_la', name: 'LA Co', timezone: 'America/Los_Angeles' },
  { id: 'acc_utc', name: 'UTC Co', timezone: 'UTC' }
];

test('hidden: buckets by the account time zone, across the start of daylight saving time', async () => {
  // US daylight saving time starts 2026-03-08 at 02:00 local. "now" is 00:30 local on 2026-03-09.
  const now = Date.parse('2026-03-09T07:30:00Z');
  const store = createStore({
    accounts,
    usage: [
      { accountId: 'acc_la', at: Date.parse('2026-03-07T12:00:00Z'), units: 2, metric: 'api_calls' },  // Mar 7, 04:00 local
      { accountId: 'acc_la', at: Date.parse('2026-03-09T05:00:00Z'), units: 5, metric: 'api_calls' },  // Mar 8, 22:00 local
      { accountId: 'acc_la', at: Date.parse('2026-03-09T07:10:00Z'), units: 1, metric: 'api_calls' },  // Mar 9, 00:10 local
      { accountId: 'acc_utc', at: Date.parse('2026-03-08T12:00:00Z'), units: 40, metric: 'api_calls' }
    ]
  });
  const out = await usage.dailyUsage(store, 'acc_la', 3, now);
  assert.deepEqual(out.map(dayOf), ['2026-03-07', '2026-03-08', '2026-03-09']);
  assert.deepEqual(out.map(amount), [2, 5, 1]);
});

test('hidden: one entry per day including days with no usage, summing units', async () => {
  const now = Date.parse('2026-05-20T15:00:00Z');
  const store = createStore({
    accounts,
    usage: [
      { accountId: 'acc_utc', at: Date.parse('2026-05-14T09:00:00Z'), units: 3, metric: 'api_calls' },
      { accountId: 'acc_utc', at: Date.parse('2026-05-14T10:00:00Z'), units: 4, metric: 'storage_gb' },
      { accountId: 'acc_utc', at: Date.parse('2026-05-20T01:00:00Z'), units: 6, metric: 'api_calls' }
    ]
  });
  const out = await usage.dailyUsage(store, 'acc_utc', 7, now);
  assert.deepEqual(out.map(dayOf), ['2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18', '2026-05-19', '2026-05-20']);
  assert.deepEqual(out.map(amount), [7, 0, 0, 0, 0, 0, 6]);
});

test('hidden: an older account with only a region counts days in that region, and our probes are not usage', async () => {
  const now = Date.parse('2026-07-02T12:00:00Z'); // 05:00 on Jul 2 in Los Angeles
  const store = createStore({
    accounts: [{ id: 'acc_old', name: 'Old Co', region: 'us-west' }],
    usage: [
      { accountId: 'acc_old', at: Date.parse('2026-07-02T03:00:00Z'), units: 4, metric: 'build_minutes' },   // Jul 1, 20:00 local
      { accountId: 'acc_old', at: Date.parse('2026-07-02T08:00:00Z'), units: 3, metric: 'api_calls' },       // Jul 2, 01:00 local
      { accountId: 'acc_old', at: Date.parse('2026-07-02T09:00:00Z'), units: 500, metric: 'synthetic_probe' }
    ]
  });
  const out = await usage.dailyUsage(store, 'acc_old', 2, now);
  assert.deepEqual(out.map(dayOf), ['2026-07-01', '2026-07-02']);
  assert.deepEqual(out.map(amount), [4, 3]);
});

test('hidden: days older than the raw-event window come from the daily rollups', async () => {
  const now = Date.parse('2026-08-31T18:00:00Z');
  const store = createStore({
    accounts,
    rollups: [
      { accountId: 'acc_utc', day: '2026-08-02', metric: 'api_calls', units: 11 },
      { accountId: 'acc_utc', day: '2026-08-10', metric: 'api_calls', units: 20 },
      { accountId: 'acc_utc', day: '2026-08-10', metric: 'storage_gb', units: 2 },
      { accountId: 'acc_utc', day: '2026-08-10', metric: 'synthetic_probe', units: 900 },
      { accountId: 'acc_utc', day: '2026-08-24', metric: 'api_calls', units: 5 },
      { accountId: 'acc_la', day: '2026-08-10', metric: 'api_calls', units: 77 }
    ],
    usage: [
      { accountId: 'acc_utc', at: Date.parse('2026-08-24T20:00:00Z'), units: 1, metric: 'api_calls' },
      { accountId: 'acc_utc', at: Date.parse('2026-08-31T09:00:00Z'), units: 8, metric: 'api_calls' }
    ]
  });
  const out = await usage.dailyUsage(store, 'acc_utc', 30, now);
  assert.equal(out.length, 30);
  const byDay = Object.fromEntries(out.map(e => [dayOf(e), amount(e)]));
  assert.equal(dayOf(out[0]), '2026-08-02');
  assert.equal(byDay['2026-08-02'], 11);
  assert.equal(byDay['2026-08-10'], 22);
  assert.equal(byDay['2026-08-24'], 6);
  assert.equal(byDay['2026-08-31'], 8);
  assert.equal(out.reduce((s, e) => s + amount(e), 0), 47);
});
