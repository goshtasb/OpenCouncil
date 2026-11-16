'use strict';
const { encodeCursor, decodeCursor } = require('./cursor');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Lists an org's users, oldest id first, one page at a time.
 * @returns {{ items: object[], nextCursor: string | null }} pass nextCursor back to get the next page
 */
function listUsers(db, { orgId, limit = DEFAULT_LIMIT, cursor = null } = {}) {
  const size = Math.min(Math.max(1, limit | 0), MAX_LIMIT);
  const after = cursor ? decodeCursor(cursor).id : null;
  const rows = db.users
    .filter(u => u.orgId === orgId && (after === null || u.id > after))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = rows.slice(0, size);
  const nextCursor = rows.length > size ? encodeCursor({ id: items[items.length - 1].id }) : null;
  return { items, nextCursor };
}

module.exports = { listUsers, DEFAULT_LIMIT, MAX_LIMIT };
