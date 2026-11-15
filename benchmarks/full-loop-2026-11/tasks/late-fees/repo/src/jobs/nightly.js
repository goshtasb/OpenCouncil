'use strict';
const { isOpen, daysPastDue } = require('../invoices');

/** Marks open invoices past their due date as overdue. Runs daily; see README. */
async function runNightly(store, now = Date.now()) {
  let changed = 0;
  for (const invoice of await store.all()) {
    if (!isOpen(invoice)) continue;
    if (invoice.status === 'open' && daysPastDue(invoice, now) > 0) {
      invoice.status = 'overdue';
      await store.save(invoice);
      changed++;
    }
  }
  return { changed };
}

module.exports = { runNightly };
