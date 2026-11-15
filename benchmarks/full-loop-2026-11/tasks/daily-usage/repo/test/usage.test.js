'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { totalUsage } = require('../src/usage');

test('totals usage for an account', async () => {
  const store = createStore({
    accounts: [{ id: 'a1', name: 'Acme', timezone: 'Europe/Berlin' }],
    usage: [{ accountId: 'a1', at: 1000, units: 3, metric: 'api_calls' }, { accountId: 'a2', at: 1000, units: 9, metric: 'api_calls' }]
  });
  assert.equal(await totalUsage(store, 'a1'), 3);
});
