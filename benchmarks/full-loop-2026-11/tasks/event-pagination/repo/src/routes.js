'use strict';
const { listUsers } = require('./users');
const { listEvents } = require('./events');

/** Maps API routes to handlers. Each handler gets (db, params, query) and returns the JSON body. */
const routes = {
  'GET /orgs/:orgId/users': (db, { orgId }, query) =>
    listUsers(db, { orgId, limit: query.limit ? Number(query.limit) : undefined, cursor: query.cursor || null }),
  'GET /orgs/:orgId/events': (db, { orgId }) => listEvents(db, { orgId })
};

module.exports = { routes };
