'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { recordEvent } = require('../src/events');
const { exportEventsCsv } = require('../src/export');

test('exports the audit trail as CSV', () => {
  const db = createDb();
  recordEvent(db, { orgId: 'org_1', type: 'login', actorId: 'usr_1', createdAt: 1000 });
  recordEvent(db, { orgId: 'org_1', type: 'role,changed', actorId: 'usr_2', createdAt: 2000 });
  recordEvent(db, { orgId: 'org_2', type: 'login', actorId: 'usr_9', createdAt: 1500 });
  assert.equal(exportEventsCsv(db, 'org_1'), 'id,createdAt,type,actorId\nevt_00000002,2000,"role,changed",usr_2\nevt_00000001,1000,login,usr_1');
});
