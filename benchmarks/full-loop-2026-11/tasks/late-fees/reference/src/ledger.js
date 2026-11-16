'use strict';

// General-ledger account for each kind of invoice line (chart of accounts from finance).
const KIND_ACCOUNTS = {
  item: '4000',      // Service revenue
  expense: '4050',   // Rebilled expenses
  discount: '4900',  // Discounts given
  tax: '2200',       // Sales tax payable
  late_fee: '4100'   // Other income
};

/**
 * Journal lines for one invoice, for the month-end export to the accounting system.
 * Throws on a line kind with no account, so nothing is ever posted to the wrong place.
 */
function ledgerEntries(invoice) {
  return invoice.lines.map(line => {
    const account = KIND_ACCOUNTS[line.kind];
    if (!account) throw new Error(`No ledger account for line kind '${line.kind}' on ${invoice.id}`);
    return { invoiceId: invoice.id, account, amount: line.amount, memo: line.description };
  });
}

/** Month-end export: every invoice's journal lines. One bad invoice fails the whole export. */
function monthEndExport(invoices) {
  return invoices.flatMap(ledgerEntries);
}

module.exports = { KIND_ACCOUNTS, ledgerEntries, monthEndExport };
