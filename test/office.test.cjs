const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { lib, setup } = require('./helpers.cjs');

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('office server: status API, traversal blocked, directory requests do not crash', async () => {
  const ctx = setup();
  ctx.pipeline.addItem('<img src=x onerror=alert(1)>', 1, '');
  ctx.sessions.setActivity('chief_engineer', 'busy', 'Reviewing draft v1');
  const server = new lib.OfficeServer(ctx.config, ctx.pipeline, ctx.sessions);
  const port = await server.start(0);
  try {
    const status = await rawGet(port, '/api/status');
    assert.equal(status.status, 200);
    const state = JSON.parse(status.body);
    assert.equal(state.claude.state, 'busy');
    assert.equal(state.pipeline.items.length, 1);

    for (const p of ['/../server.js', '/../../../package.json', '/%2e%2e/server.js', '/..%2f..%2fpackage.json']) {
      const r = await rawGet(port, p);
      assert.ok(r.status === 403 || (r.status === 200 && r.body.startsWith('<!doctype html>')), `${p} → ${r.status} ${r.body.slice(0, 40)}`);
      assert.doesNotMatch(r.body, /use strict|"name": "open-council"/);
    }
    const dir = await rawGet(port, '/../');
    assert.ok(dir.status === 403 || dir.body.startsWith('<!doctype html>'), `/../ → ${dir.status}`);
    assert.equal((await rawGet(port, '/')).status, 200, 'server survived');
    assert.equal((await rawGet(port, '/?x=1')).status, 200);
  } finally {
    await server.stop();
  }
});
