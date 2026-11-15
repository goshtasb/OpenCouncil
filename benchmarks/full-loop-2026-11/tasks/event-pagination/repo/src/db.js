'use strict';

/** In-memory tables for tests and local dev. */
function createDb({ users = [], events = [] } = {}) {
  return { users: [...users], events: [...events], nextEventId: events.length + 1 };
}

module.exports = { createDb };
