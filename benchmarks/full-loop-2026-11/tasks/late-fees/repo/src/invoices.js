'use strict';
const { formatMoney } = require('./money');

const DAY_MS = 24 * 60 * 60 * 1000;

// Line amounts are in dollars.
function invoiceTotal(invoice) {
  return invoice.lines.reduce((sum, line) => sum + line.amount, 0);
}

function isOpen(invoice) {
  return invoice.paidAt == null && invoice.status !== 'void' && invoice.status !== 'paid';
}

function daysPastDue(invoice, now = Date.now()) {
  return Math.floor((now - invoice.dueDate) / DAY_MS);
}

function formatInvoice(invoice) {
  const rows = invoice.lines.map(l => `${l.description.padEnd(32)} ${formatMoney(l.amount)}`);
  rows.push(`${'Total'.padEnd(32)} ${formatMoney(invoiceTotal(invoice))}`);
  return rows.join('\n');
}

module.exports = { DAY_MS, invoiceTotal, isOpen, daysPastDue, formatInvoice };
