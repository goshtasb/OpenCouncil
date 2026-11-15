'use strict';
const { encodeCursor, decodeCursor } = require('./cursor');
const { DEFAULT_LIMIT, MAX_LIMIT } = require('./users');

// Newest first; id breaks ties, since imports give many events the same createdAt.
const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** An org's audit events, newest first, one page at a time (same contract as listUsers). */
function listEvents(db, { orgId, limit = DEFAULT_LIMIT, cursor = null } = {}) {
  const size = Math.min(Math.max(1, limit | 0), MAX_LIMIT);
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = db.events
    .filter(e => e.orgId === orgId && (after === null || newestFirst(e, after) > 0))
    .sort(newestFirst);
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  const nextCursor = rows.length > size ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { items, nextCursor };
}

function recordEvent(db, { orgId, type, actorId, createdAt = Date.now() }) {
  const event = { id: `evt_${String(db.nextEventId++).padStart(8, '0')}`, orgId, type, actorId, createdAt };
  db.events.push(event);
  return event;
}

module.exports = { listEvents, recordEvent };
