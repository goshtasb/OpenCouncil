'use strict';
const { DAY_MS } = require('../src/invoices');
const NOW = Date.UTC(2026, 2, 15, 2, 0, 0);
function invoice(overrides = {}) {
  return {
    id: 'inv_1', clientId: 'cl_1', issuedAt: NOW - 40 * DAY_MS, dueDate: NOW - 10 * DAY_MS, paidAt: null, status: 'open',
    lines: [{ kind: 'item', description: 'March retainer', amount: 450000 }], ...overrides
  };
}
module.exports = { NOW, DAY_MS, invoice };
