'use strict';
const { listUsers } = require('./users');
const { listEvents } = require('./events');

const pageQuery = query => ({ limit: query.limit ? Number(query.limit) : undefined, cursor: query.cursor || null });

/** Maps API routes to handlers. Each handler gets (db, params, query) and returns the JSON body. */
const routes = {
  'GET /orgs/:orgId/users': (db, { orgId }, query) => listUsers(db, { orgId, ...pageQuery(query) }),
  'GET /orgs/:orgId/events': (db, { orgId }, query) => listEvents(db, { orgId, ...pageQuery(query) })
};

module.exports = { routes };
