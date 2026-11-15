'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { recordEvent } = require('../src/events');

test('records an event', () => {
  const db = createDb();
  const e = recordEvent(db, { orgId: 'org_1', type: 'login', actorId: 'usr_1', createdAt: 1000 });
  assert.equal(e.id, 'evt_00000001');
  assert.equal(db.events.length, 1);
});
