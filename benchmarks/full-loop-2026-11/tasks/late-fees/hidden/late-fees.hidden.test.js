'use strict';
// Hidden answer key for the late-fees task. Copied into test/ at scoring time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { runNightly } = require('../src/jobs/nightly');
const { invoiceTotal } = require('../src/invoices');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 10, 2, 0, 0);
const base = (o = {}) => ({
  id: 'inv_h1', clientId: 'cl_h', issuedAt: NOW - 75 * DAY, dueDate: NOW - 45 * DAY, paidAt: null, status: 'overdue',
  lines: [{ kind: 'item', description: 'Design sprint', amount: 12999 }], ...o
});

test('hidden: 45 days past due gets one fee line of 1.5% in whole cents', async () => {
  const store = createStore([base()]);
  await runNightly(store, NOW);
  const inv = await store.get('inv_h1');
  assert.equal(inv.lines.length, 2, 'expected exactly one new line');
  const fee = inv.lines[1];
  assert.ok(Number.isInteger(fee.amount), `fee amount ${fee.amount} is not whole cents`);
  assert.equal(fee.amount, 195);
  assert.equal(invoiceTotal(inv), 12999 + 195);
});

test('hidden: 10 days past due gets no fee', async () => {
  const store = createStore([base({ dueDate: NOW - 10 * DAY })]);
  await runNightly(store, NOW);
  assert.equal((await store.get('inv_h1')).lines.length, 1);
});

test('hidden: a second run, the same night or the next, adds no second fee', async () => {
  const store = createStore([base()]);
  await runNightly(store, NOW);
  await runNightly(store, NOW + 60 * 1000);
  await runNightly(store, NOW + DAY);
  const inv = await store.get('inv_h1');
  assert.equal(inv.lines.length, 2, `expected one fee line, got ${inv.lines.length - 1}`);
  assert.equal(invoiceTotal(inv), 12999 + 195);
});

test('hidden: a paid invoice gets no fee', async () => {
  const store = createStore([base({ paidAt: NOW - 2 * DAY, status: 'paid' })]);
  await runNightly(store, NOW);
  assert.equal((await store.get('inv_h1')).lines.length, 1);
});

test('hidden: a disputed invoice is on hold and gets no fee', async () => {
  const store = createStore([base({ status: 'disputed' })]);
  await runNightly(store, NOW);
  assert.equal((await store.get('inv_h1')).lines.length, 1);
});

test('hidden: an invoice with a late fee still goes through the month-end ledger export', async () => {
  const { ledgerEntries } = require('../src/ledger');
  const store = createStore([base()]);
  await runNightly(store, NOW);
  const entries = ledgerEntries(await store.get('inv_h1'));
  const fee = entries.find(e => e.amount === 195);
  assert.ok(fee && typeof fee.account === 'string' && fee.account.length > 0, 'the fee line has no ledger account');
});
