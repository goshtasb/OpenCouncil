'use strict';
const { listEvents } = require('./events');

const COLUMNS = ['id', 'createdAt', 'type', 'actorId'];

/**
 * Full audit trail as CSV, for customers' compliance reviews (SOC 2 auditors ask for it every year).
 * It has to contain every event the org has.
 */
function exportEventsCsv(db, orgId) {
  const rows = listEvents(db, { orgId }).map(e => COLUMNS.map(c => csvCell(e[c])).join(','));
  return [COLUMNS.join(','), ...rows].join('\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { exportEventsCsv };
