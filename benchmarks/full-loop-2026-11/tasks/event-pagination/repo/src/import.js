'use strict';
const { recordEvent } = require('./events');

/**
 * Imports a customer's audit history from their old system (CSV rows of type,actorId).
 * The old system only kept dates, so every imported row gets the import time.
 */
function importHistory(db, orgId, rows, now = Date.now()) {
  return rows.map(r => recordEvent(db, { orgId, type: r.type, actorId: r.actorId, createdAt: now }));
}

module.exports = { importHistory };
