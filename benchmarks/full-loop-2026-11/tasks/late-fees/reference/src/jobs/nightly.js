'use strict';
const { isOpen, daysPastDue, invoiceTotal } = require('../invoices');
const { roundMoney } = require('../money');

const LATE_FEE_RATE = 0.015;
const LATE_FEE_AFTER_DAYS = 30;

/** Marks open invoices past their due date as overdue and adds a one-time late fee. Runs daily; see README. */
async function runNightly(store, now = Date.now()) {
  let changed = 0;
  for (const invoice of await store.all()) {
    if (!isOpen(invoice)) continue;
    let dirty = false;
    if (invoice.status === 'open' && daysPastDue(invoice, now) > 0) { invoice.status = 'overdue'; dirty = true; }
    if (invoice.status !== 'disputed' && daysPastDue(invoice, now) >= LATE_FEE_AFTER_DAYS && !invoice.lines.some(l => l.kind === 'late_fee')) {
      invoice.lines.push({ kind: 'late_fee', description: 'Late fee (1.5%)', amount: roundMoney(invoiceTotal(invoice) * LATE_FEE_RATE) });
      dirty = true;
    }
    if (dirty) { await store.save(invoice); changed++; }
  }
  return { changed };
}

module.exports = { runNightly };
