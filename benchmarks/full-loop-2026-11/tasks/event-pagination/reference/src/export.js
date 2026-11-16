'use strict';
const { listEvents } = require('./events');

const COLUMNS = ['id', 'createdAt', 'type', 'actorId'];

/**
 * Full audit trail as CSV, for customers' compliance reviews (SOC 2 auditors ask for it every year).
 * It has to contain every event the org has, so it walks every page.
 */
function exportEventsCsv(db, orgId) {
  const rows = [];
  let cursor = null;
  do {
    const page = listEvents(db, { orgId, limit: 200, cursor });
    for (const e of page.items) rows.push(COLUMNS.map(c => csvCell(e[c])).join(','));
    cursor = page.nextCursor;
  } while (cursor);
  return [COLUMNS.join(','), ...rows].join('\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { exportEventsCsv };
