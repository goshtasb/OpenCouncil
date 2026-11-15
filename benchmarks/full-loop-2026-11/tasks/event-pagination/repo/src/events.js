'use strict';

/** An org's audit events, newest first. */
function listEvents(db, { orgId } = {}) {
  return db.events
    .filter(e => e.orgId === orgId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function recordEvent(db, { orgId, type, actorId, createdAt = Date.now() }) {
  const event = { id: `evt_${String(db.nextEventId++).padStart(8, '0')}`, orgId, type, actorId, createdAt };
  db.events.push(event);
  return event;
}

module.exports = { listEvents, recordEvent };
