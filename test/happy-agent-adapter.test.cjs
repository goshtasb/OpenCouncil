// SPIKE: the happy-agent seat adapter against a stand-in daemon on a Unix socket. It serves only the
// routes the adapter calls, in the shapes the real daemon (Happy Agent 2026.11.5) answered with
// during the spike. The real daemon was also run by hand; see docs/spikes/happy-agent.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { HappyAgentAdapter } = require('../dist/adapters/happy-agent.js');

function fakeDaemon(runFor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-'));
  const socket = path.join(dir, 's.sock');
  fs.writeFileSync(path.join(dir, 'token'), 'test-token\n');
  const sent = [];
  const runs = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (req.headers.authorization !== 'Bearer test-token') return json(401, { error: { message: 'no' } });
      const url = req.url.split('?')[0];
      if (url === '/v0/health') return json(200, { ready: true });
      if (url === '/v0/config') return json(200, { config: {
        models: { 'antigravity/gemini-4-argon': { defaultEffort: 'medium' } },
        providers: { antigravity: { enabled: true, models: [{ id: 'antigravity/gemini-4-argon', enabled: true }] }, claude: { enabled: false, models: [] } },
      } });
      if (url === '/v0/projects') return json(200, { project: { id: 'proj1' } });
      if (url === '/v0/agents') return json(201, { agent: { id: 'agent1', workspaceId: JSON.parse(body).workspaceId } });
      if (url === '/v0/agents/agent1/send') {
        const msg = JSON.parse(body);
        sent.push(msg);
        runs.set('m1', { polls: 0 });
        return json(200, { message: { id: 'm1' } });
      }
      if (url === '/v0/agents/agent1/messages') {
        const state = runs.get('m1');
        state.polls++;
        return json(200, { runs: [runFor(state.polls, sent[sent.length - 1])] });
      }
      if (url === '/v0/agents/agent1/archive' || url === '/v0/agents/agent1/abort') return json(200, {});
      json(404, { error: { message: 'The requested endpoint does not exist.' } });
    });
  });
  return new Promise(resolve => server.listen(socket, () => resolve({ dir, socket, sent, close: () => server.close() })));
}

const userMsg = { id: 'm1', role: 'user', content: [{ type: 'text', text: 'x' }] };

async function withDaemon(runFor, fn) {
  const d = await fakeDaemon(runFor);
  const saved = { ...process.env };
  process.env.HAPPY_AGENT_SOCKET = d.socket;
  process.env.HAPPY_AGENT_TOKEN_FILE = path.join(d.dir, 'token');
  try { await fn(d, new HappyAgentAdapter(10)); } finally { d.close(); process.env = saved; }
}

test('happy-agent seat: sends read_only for a plan seat, resolves the provider, returns the last agent text', async () => {
  await withDaemon((polls) => polls < 3
    ? { id: 'm1', status: 'running', messages: [userMsg] }
    : { id: 'm1', status: 'completed', reason: 'completed', messages: [userMsg,
        { role: 'agent', content: [{ type: 'tool_call', name: 'read' }, { type: 'text', text: 'looking' }] },
        { role: 'agent', content: [{ type: 'text', text: 'VERDICT: approve' }] }] },
  async (d, adapter) => {
    assert.strictEqual(await adapter.isAvailable(), true);
    const out = await adapter.runPrompt('review', { cwd: d.dir, model: 'antigravity/gemini-4-argon', permissionMode: 'plan', timeoutSeconds: 30 });
    assert.strictEqual(out, 'VERDICT: approve');
    assert.deepStrictEqual(d.sent[0].mode, { providerId: 'antigravity', modelId: 'antigravity/gemini-4-argon', effort: 'medium', serviceTier: null, permissionMode: 'read_only' });
  });
});

test('happy-agent seat: a failed run (the seat died) is an error at once, with the daemon\'s reason', async () => {
  await withDaemon(() => ({ id: 'm1', status: 'failed', reason: 'error', messages: [userMsg,
    { role: 'service', content: [{ type: 'text', text: 'ACP connection closed' }], failure: { kind: 'internal', message: 'ACP connection closed' } }] }),
  async (d, adapter) => {
    await assert.rejects(adapter.runPrompt('x', { cwd: d.dir, model: 'antigravity/gemini-4-argon', permissionMode: 'plan', timeoutSeconds: 30 }),
      (err) => err.name === 'HappyAgentError' && err.kind === 'internal' && /ACP connection closed/.test(err.message));
  });
});

test('happy-agent seat: a model the daemon does not offer is a clear error', async () => {
  await withDaemon(() => ({}), async (d, adapter) => {
    await assert.rejects(adapter.runPrompt('x', { cwd: d.dir, model: 'anthropic/opus-5', permissionMode: 'plan' }), /offers no enabled model "anthropic\/opus-5"/);
  });
});

test('happy-agent seat: a run that never ends times out', async () => {
  await withDaemon(() => ({ id: 'm1', status: 'running', messages: [userMsg] }), async (d, adapter) => {
    await assert.rejects(adapter.runPrompt('x', { cwd: d.dir, model: 'antigravity/gemini-4-argon', permissionMode: 'plan', timeoutSeconds: 0.2 }), (err) => err.timedOut === true);
  });
});

test('happy-agent seat: no daemon is a clear "not running" error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-'));
  fs.writeFileSync(path.join(dir, 'token'), 't');
  const saved = { ...process.env };
  process.env.HAPPY_AGENT_SOCKET = path.join(dir, 'missing.sock');
  process.env.HAPPY_AGENT_TOKEN_FILE = path.join(dir, 'token');
  try {
    const adapter = new HappyAgentAdapter(10);
    assert.strictEqual(await adapter.isAvailable(), false);
    await assert.rejects(adapter.runPrompt('x', { cwd: dir, model: 'm', permissionMode: 'plan' }), (err) => err.kind === 'daemon-down');
  } finally { process.env = saved; }
});
