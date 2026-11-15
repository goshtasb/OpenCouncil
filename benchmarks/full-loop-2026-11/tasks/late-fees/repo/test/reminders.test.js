'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { remindersDue } = require('../src/reminders');
const { ledgerEntries } = require('../src/ledger');
const { NOW, DAY_MS, invoice } = require('./helpers');

test('sends the next reminder once it is due', () => {
  const due = remindersDue([invoice({ dueDate: NOW - 22 * DAY_MS, remindersSent: 1 }), invoice({ id: 'inv_2', status: 'disputed', dueDate: NOW - 50 * DAY_MS })], NOW);
  assert.deepEqual(due.map(r => [r.invoiceId, r.step]), [['inv_1', 2]]);
});

test('posts each line to its ledger account', () => {
  const inv = invoice({ lines: [{ kind: 'item', description: 'Retainer', amount: 450000 }, { kind: 'discount', description: 'Loyalty', amount: -45000 }] });
  assert.deepEqual(ledgerEntries(inv).map(e => [e.account, e.amount]), [['4000', 450000], ['4900', -45000]]);
});
