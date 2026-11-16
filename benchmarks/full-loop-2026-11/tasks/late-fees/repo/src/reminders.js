'use strict';
const { isOpen, daysPastDue, invoiceTotal } = require('./invoices');
const { formatMoney } = require('./money');

const REMINDER_DAYS = [7, 21, 45];

/** Reminder emails for overdue invoices, sent by the nightly job's mailer. */
function remindersDue(invoices, now = Date.now()) {
  const out = [];
  for (const invoice of invoices) {
    if (!isOpen(invoice)) continue;
    // Disputed invoices are on hold while finance reviews them: no reminders, no late charges.
    if (invoice.status === 'disputed') continue;
    const days = daysPastDue(invoice, now);
    const step = REMINDER_DAYS.filter(d => days >= d).length;
    if (step > (invoice.remindersSent || 0)) {
      out.push({ invoiceId: invoice.id, step, subject: `Invoice ${invoice.id}: ${formatMoney(invoiceTotal(invoice))} is ${days} days overdue` });
    }
  }
  return out;
}

module.exports = { remindersDue, REMINDER_DAYS };
