// SPIKE: the direct-ACP seat adapter against a fake ACP agent (test/fixtures/fake-acp-agent.cjs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AcpAdapter } = require('../dist/adapters/acp.js');

const FAKE = path.join(__dirname, 'fixtures', 'fake-acp-agent.cjs');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-seat-'));
  const log = path.join(dir, 'agent.log');
  const adapter = new AcpAdapter({ name: 'fake-acp', command: process.execPath, args: [FAKE], env: { FAKE_ACP_LOG: log } });
  const logged = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  return { dir, adapter, logged };
}

test('acp seat: answers with the streamed text and sets plan mode for a read-only seat', async () => {
  const { dir, adapter, logged } = setup();
  const out = await adapter.runPrompt('review the spec', { cwd: dir, permissionMode: 'plan', model: 'fake-model', timeoutSeconds: 30 });
  assert.match(out, /^fake answer: review the spec/);
  assert.deepStrictEqual(logged().filter(e => e.set).map(e => [e.set, e.value]), [['mode', 'plan'], ['model', 'fake-model']]);
  assert.strictEqual(adapter.lastReport.modeSet, 'plan');
});

test('acp seat: a read-only seat refuses the agent\'s ask to write, and nothing is written', async () => {
  const { dir, adapter } = setup();
  const out = await adapter.runPrompt('SCENARIO:write', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 30 });
  assert.strictEqual(out, 'DENIED');
  assert.strictEqual(fs.existsSync(path.join(dir, 'fake-write.txt')), false);
  assert.deepStrictEqual(adapter.lastReport.permissionAsks.map(a => [a.kind, a.answer]), [['edit', 'reject_once']]);
});

test('acp seat: the no-tool seat (no permission mode) is read-only too', async () => {
  const { dir, adapter } = setup();
  assert.strictEqual(await adapter.runPrompt('SCENARIO:write', { cwd: dir, timeoutSeconds: 30 }), 'DENIED');
  assert.strictEqual(fs.existsSync(path.join(dir, 'fake-write.txt')), false);
});

test('acp seat: an exec seat may edit', async () => {
  const { dir, adapter } = setup();
  assert.strictEqual(await adapter.runPrompt('SCENARIO:write', { cwd: dir, permissionMode: 'exec', timeoutSeconds: 30 }), 'WROTE');
  assert.strictEqual(fs.existsSync(path.join(dir, 'fake-write.txt')), true);
});

test('acp seat: an agent that dies mid-turn fails fast with a clear error, not a timeout', async () => {
  const { dir, adapter } = setup();
  const started = Date.now();
  await assert.rejects(adapter.runPrompt('SCENARIO:die', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 60 }), (err) => {
    assert.match(err.message, /exited mid-turn \(code 3/);
    assert.ok(!err.timedOut);
    return true;
  });
  assert.ok(Date.now() - started < 5000, 'failure should arrive in seconds');
});

test('acp seat: a hung agent times out and is killed', async () => {
  const { dir, adapter } = setup();
  await assert.rejects(adapter.runPrompt('SCENARIO:hang', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 1 }), (err) => err.timedOut === true);
});

test('acp seat: a missing agent command is a clear error', async () => {
  const adapter = new AcpAdapter({ name: 'nope', command: '/nonexistent/agy', args: ['acp'] });
  assert.strictEqual(await adapter.isAvailable(), false);
  await assert.rejects(adapter.runPrompt('x', { cwd: os.tmpdir(), permissionMode: 'plan', timeoutSeconds: 5 }), /ENOENT/);
});
