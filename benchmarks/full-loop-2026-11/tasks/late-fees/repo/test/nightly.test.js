'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { runNightly } = require('../src/jobs/nightly');
const { NOW, DAY_MS, invoice } = require('./helpers');

test('marks past-due invoices overdue', async () => {
  const store = createStore([invoice(), invoice({ id: 'inv_2', dueDate: NOW + 5 * DAY_MS })]);
  await runNightly(store, NOW);
  assert.equal((await store.get('inv_1')).status, 'overdue');
  assert.equal((await store.get('inv_2')).status, 'open');
});

test('leaves paid invoices alone', async () => {
  const store = createStore([invoice({ paidAt: NOW - DAY_MS, status: 'paid' })]);
  await runNightly(store, NOW);
  assert.equal((await store.get('inv_1')).status, 'paid');
});
