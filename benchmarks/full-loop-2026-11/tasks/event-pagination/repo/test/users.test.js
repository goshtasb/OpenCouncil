'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { listUsers } = require('../src/users');

const users = Array.from({ length: 7 }, (_, i) => ({ id: `usr_${i + 1}`, orgId: 'org_1', name: `User ${i + 1}` }));

test('pages through users', () => {
  const db = createDb({ users: [...users, { id: 'usr_x', orgId: 'org_2' }] });
  const first = listUsers(db, { orgId: 'org_1', limit: 3 });
  assert.deepEqual(first.items.map(u => u.id), ['usr_1', 'usr_2', 'usr_3']);
  const second = listUsers(db, { orgId: 'org_1', limit: 3, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(u => u.id), ['usr_4', 'usr_5', 'usr_6']);
  const third = listUsers(db, { orgId: 'org_1', limit: 3, cursor: second.nextCursor });
  assert.deepEqual(third.items.map(u => u.id), ['usr_7']);
  assert.equal(third.nextCursor, null);
});
