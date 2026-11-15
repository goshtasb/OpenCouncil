'use strict';
// Hidden answer key for the event-pagination task. Copied into test/ at scoring time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('../src/db');
const { listEvents, recordEvent } = require('../src/events');
const { importHistory } = require('../src/import');

function seed() {
  const db = createDb();
  for (let i = 0; i < 6; i++) recordEvent(db, { orgId: 'org_h', type: 'login', actorId: 'u', createdAt: 1000 + i * 10 });
  importHistory(db, 'org_h', Array.from({ length: 11 }, (_, i) => ({ type: 'imported', actorId: `old_${i}` })), 5000);
  for (let i = 0; i < 4; i++) recordEvent(db, { orgId: 'org_h', type: 'logout', actorId: 'u', createdAt: 9000 + i });
  for (let i = 0; i < 5; i++) recordEvent(db, { orgId: 'org_other', type: 'login', actorId: 'z', createdAt: 5000 });
  return db;
}

function pageAll(db, limit, between) {
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const page = listEvents(db, { orgId: 'org_h', limit, cursor });
    assert.ok(page && Array.isArray(page.items), 'listEvents should return { items, nextCursor }');
    assert.ok(page.items.length <= limit, `page has ${page.items.length} items, limit ${limit}`);
    seen.push(...page.items);
    cursor = page.nextCursor;
    if (between) between(pages);
    assert.ok(++pages < 100, 'pagination never ended');
  } while (cursor);
  return seen;
}

test('hidden: paging through events with equal timestamps returns each one exactly once, newest first', () => {
  const db = seed();
  for (const limit of [1, 3, 4, 7]) {
    const seen = pageAll(db, limit);
    const ids = seen.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, `limit ${limit}: duplicate events`);
    assert.equal(ids.length, 21, `limit ${limit}: expected 21 events, got ${ids.length}`);
    assert.ok(seen.every(e => e.orgId === 'org_h'), `limit ${limit}: another org's events leaked in`);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i - 1].createdAt >= seen[i].createdAt, `limit ${limit}: not newest first`);
  }
});

test('hidden: an event recorded while a client is paging does not shift or repeat older events', () => {
  const db = seed();
  const seen = pageAll(db, 4, () => recordEvent(db, { orgId: 'org_h', type: 'login', actorId: 'new', createdAt: 99999 }));
  const old = seen.filter(e => e.actorId !== 'new').map(e => e.id);
  assert.equal(new Set(old).size, old.length, 'an older event came back twice');
  assert.equal(old.length, 21, `expected all 21 older events, got ${old.length}`);
});

test('hidden: follows the listUsers limits (default 50, at most 200) and ends with a null cursor', () => {
  const db = createDb();
  for (let i = 0; i < 250; i++) recordEvent(db, { orgId: 'org_h', type: 'x', actorId: 'u', createdAt: 1000 + (i % 7) });
  const dflt = listEvents(db, { orgId: 'org_h' });
  assert.equal(dflt.items.length, 50);
  const big = listEvents(db, { orgId: 'org_h', limit: 1000 });
  assert.equal(big.items.length, 200);
  const rest = listEvents(db, { orgId: 'org_h', limit: 200, cursor: big.nextCursor });
  assert.equal(rest.items.length, 50);
  assert.equal(rest.nextCursor, null);
});

test('hidden: the compliance CSV export still contains every event', () => {
  const { exportEventsCsv } = require('../src/export');
  const db = createDb();
  for (let i = 0; i < 437; i++) recordEvent(db, { orgId: 'org_h', type: 'x', actorId: 'u', createdAt: 1000 + (i % 13) });
  const lines = exportEventsCsv(db, 'org_h').split('\n');
  assert.equal(lines.length, 1 + 437, `export has ${lines.length - 1} of 437 events`);
  assert.equal(new Set(lines).size, lines.length, 'export repeats an event');
});

test('hidden: the events endpoint takes limit and cursor from the query string', () => {
  const { routes } = require('../src/routes');
  const db = seed();
  const handler = routes['GET /orgs/:orgId/events'];
  const first = handler(db, { orgId: 'org_h' }, { limit: '5' });
  assert.equal(first.items.length, 5);
  assert.ok(first.nextCursor);
  const second = handler(db, { orgId: 'org_h' }, { limit: '5', cursor: first.nextCursor });
  assert.equal(second.items.length, 5);
  assert.ok(second.items.every(e => !first.items.some(f => f.id === e.id)));
});
