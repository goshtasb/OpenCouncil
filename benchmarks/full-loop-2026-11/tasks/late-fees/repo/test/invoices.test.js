'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceTotal, daysPastDue, formatInvoice } = require('../src/invoices');
const { NOW, invoice } = require('./helpers');

test('totals the lines', () => {
  assert.equal(invoiceTotal(invoice({ lines: [{ kind: 'item', description: 'a', amount: 1000 }, { kind: 'item', description: 'b', amount: 250 }] })), 1250);
});

test('counts days past due', () => {
  assert.equal(daysPastDue(invoice(), NOW), 10);
});

test('formats an invoice', () => {
  assert.match(formatInvoice(invoice()), /Total\s+\$4,500\.00/);
});
