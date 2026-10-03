const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { lib, setup, ScriptedAdapter, PLAN, SHIP, SIGNOFF, LEAD_OK } = require('./helpers.cjs');

function charmConfig(overrides = {}) {
  const config = JSON.parse(JSON.stringify(lib.DEFAULT_CONFIG));
  config.charm.routing.llm_router = false;
  Object.assign(config.charm, overrides);
  return config;
}

function fakeBrains(config, scripts = {}) {
  const made = {};
  for (const brain of ['claude', 'gemini', 'grok', 'router']) {
    const name = `charm-fake-${brain}-${Math.random().toString(36).slice(2, 8)}`;
    made[brain] = new ScriptedAdapter(name, scripts[brain] || []);
    lib.registerAdapter(name, made[brain]);
    if (brain === 'router') config.charm.routing.router = { provider: name, model: '' };
    else config.charm.brains[brain] = { provider: name, model: 'test-model' };
  }
  return made;
}

// ── Routing ────────────────────────────────────────────────────────────────

test('charm routing: explicit names win, including common mishearings', async () => {
  const c = charmConfig().charm;
  const cases = [
    ['Ask Grok what bitcoin is doing', 'solo', 'grok', 'what bitcoin is doing'],
    ['hey gemini, give me product ideas for a dog app', 'solo', 'gemini', 'give me product ideas for a dog app'],
    ['Claude: fix this regex', 'solo', 'claude', 'fix this regex'],
    ['grock is this a good idea', 'solo', 'grok', 'is this a good idea'],
    ['let synapse write the brief', 'solo', 'gemini', 'write the brief'],
    ['What do all three of you think about raising prices?', 'panel', 'grok', null],
    ['Convene the council to add rate limiting to the API', 'council', null, 'add rate limiting to the API']
  ];
  for (const [text, mode, brain, rest] of cases) {
    const r = await lib.routeUtterance(text, c);
    assert.equal(r.via, 'override', text);
    assert.equal(r.mode, mode, text);
    if (brain) assert.equal(r.brain, brain, text);
    if (rest) assert.equal(r.text, rest, text);
  }
});

test('charm routing: keyword rules place clear requests in each lane', async () => {
  const c = charmConfig().charm;
  const cases = [
    ['why does my typescript build throw this stack trace', 'claude'],
    ['proofread my email to the landlord', 'claude'],
    ['brainstorm product ideas for contractors', 'gemini'],
    ["what's trending on X right now", 'grok'],
    ['be brutally honest, roast my landing page headline', 'grok']
  ];
  for (const [text, brain] of cases) {
    const r = await lib.routeUtterance(text, c);
    assert.equal(r.via, 'rules', text);
    assert.equal(r.mode, 'solo', text);
    assert.equal(r.brain, brain, text);
  }
  const decision = await lib.routeUtterance('should I use Supabase or Firebase for this', c);
  assert.equal(decision.mode, 'panel');
  assert.equal(decision.brain, 'grok', 'the judge rules a panel');
});

test('charm routing: a named project goes to Claude, and build requests only suggest the council', async () => {
  const c = charmConfig({ projects: { snapestimate: '/tmp/snap', 'open council': '/tmp/oc' } }).charm;
  const status = await lib.routeUtterance("how's SnapEstimate's auth middleware structured", c);
  assert.equal(status.brain, 'claude');
  assert.equal(status.project, 'snapestimate');
  const build = await lib.routeUtterance('implement webhook retries in snap estimate', c);
  assert.equal(build.mode, 'solo', 'never convenes unasked');
  assert.equal(build.suggestCouncil, true);
  assert.equal(build.project, 'snapestimate');
});

test('charm routing: unsure → router model; bad router reply or failure → default brain', async () => {
  const c = charmConfig().charm;
  c.routing.llm_router = true;
  const routed = await lib.routeUtterance('tell me something good', c, { askRouter: async () => 'Sure! {"mode":"solo","brain":"gemini","reason":"open-ended"}' });
  assert.equal(routed.via, 'router');
  assert.equal(routed.brain, 'gemini');
  const garbage = await lib.routeUtterance('tell me something good', c, { askRouter: async () => 'I think Gemini' });
  assert.equal(garbage.via, 'default');
  assert.equal(garbage.brain, 'claude');
  const broken = await lib.routeUtterance('tell me something good', c, { askRouter: async () => { throw new Error('cli down'); } });
  assert.equal(broken.via, 'default');
  const forced = await lib.routeUtterance('tell me something good', c, { brain: 'grok' });
  assert.equal(forced.brain, 'grok');
  assert.equal(forced.via, 'override');
});

// ── Brains ─────────────────────────────────────────────────────────────────

test('charm brains: solo answer is speech-cleaned, remembered, and Claude stays tool-less', async () => {
  const config = charmConfig();
  const fakes = fakeBrains(config, { claude: ['## Answer\n**Use** `const`.\n- one\n- two', 'Second answer.'] });
  const brains = new lib.CharmBrains(config, fs.mkdtempSync(path.join(os.tmpdir(), 'charm-scratch-')));
  const r = await brains.ask('ask claude whether to use const or let', 'c1');
  assert.equal(r.speaker, 'claude');
  assert.equal(r.answer, 'Answer\nUse const.\none\ntwo');
  assert.equal(fakes.claude.calls[0].options.permissionMode, undefined, 'no tools without a named project');
  assert.equal(fakes.claude.calls[0].options.model, 'test-model');
  await brains.ask('claude and why', 'c1');
  assert.match(fakes.claude.calls[1].prompt, /Conversation so far:[\s\S]*whether to use const or let[\s\S]*Use const/);
  assert.equal(brains.states.claude, 'idle');
});

test('charm brains: Gemini and Grok run in the empty scratch dir; Grok keeps web search', async () => {
  const config = charmConfig();
  const fakes = fakeBrains(config, { gemini: ['Idea.'], grok: ['Hot take.'] });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'charm-scratch-'));
  const brains = new lib.CharmBrains(config, scratch);
  await brains.ask('gemini brainstorm names', 'c');
  await brains.ask('grok roast it', 'c');
  assert.equal(fakes.gemini.calls[0].options.cwd, scratch);
  assert.equal(fakes.gemini.calls[0].options.permissionMode, 'plan');
  assert.equal(fakes.grok.calls[0].options.cwd, scratch);
  assert.equal(fakes.grok.calls[0].options.webSearch, true);
});

test('charm brains: a named project lets Claude read that repo in plan mode', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'charm-proj-'));
  const config = charmConfig({ projects: { snapestimate: repo } });
  const fakes = fakeBrains(config, { claude: ['It uses three auth paths.'] });
  await new lib.CharmBrains(config).ask('how does snapestimate do auth', 'c');
  assert.equal(fakes.claude.calls[0].options.cwd, repo);
  assert.equal(fakes.claude.calls[0].options.permissionMode, 'plan');
});

test('charm brains: panel asks all three, the judge rules, and one failure does not sink it', async () => {
  const config = charmConfig();
  const fakes = fakeBrains(config, {
    claude: ['Supabase: Postgres.'],
    gemini: [() => { throw new Error('agy: error: interrupted'); }],
    grok: ['Firebase is fine.', 'Ruling: Supabase, because you already use Postgres.']
  });
  const r = await new lib.CharmBrains(config).ask('should I use Supabase or Firebase', 'c');
  assert.equal(r.route.mode, 'panel');
  assert.equal(r.speaker, 'grok');
  assert.equal(r.answer, 'Ruling: Supabase, because you already use Postgres.');
  assert.match(r.panel.gemini.error, /interrupted/);
  assert.match(fakes.grok.calls[1].prompt, /CLAUDE said:[\s\S]*GROK said:/);
  assert.doesNotMatch(fakes.grok.calls[1].prompt, /GEMINI said/);
});

// ── Server ─────────────────────────────────────────────────────────────────

function request(port, method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    } }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitFor(fn, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

test('charm server: token required, persisted 0600, ask and route work', async () => {
  const ctx = setup();
  const config = Object.assign(ctx.config, { charm: charmConfig().charm });
  fakeBrains(config, { grok: ['Markets are up.'] });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'charm-state-'));
  const server = new lib.CharmServer(config, { repoRoot: ctx.repo, stateDir, sessionManager: ctx.sessions, pipelineManager: ctx.pipeline });
  const port = await server.start(0, '127.0.0.1');
  try {
    const token = server.authToken;
    assert.ok(token.length >= 40);
    assert.equal(fs.statSync(path.join(stateDir, 'token')).mode & 0o777, 0o600);
    assert.equal(lib.loadOrCreateToken(stateDir), token, 'stable across restarts');

    assert.equal((await request(port, 'GET', '/charm/health')).status, 200);
    assert.equal((await request(port, 'GET', '/charm/status')).status, 401);
    assert.equal((await request(port, 'GET', '/charm/status', { token: token + 'x' })).status, 401);
    assert.equal((await request(port, 'POST', '/charm/ask', { token: 'short', body: { text: 'hi' } })).status, 401);

    const status = await request(port, 'GET', '/charm/status', { token });
    assert.deepEqual(Object.keys(status.body.faces).sort(), ['claude', 'gemini', 'grok']);

    const route = await request(port, 'POST', '/charm/route', { token, body: { text: 'what is bitcoin doing today' } });
    assert.equal(route.body.brain, 'grok');

    const ask = await request(port, 'POST', '/charm/ask', { token, body: { text: 'what is bitcoin doing today' } });
    assert.equal(ask.status, 200);
    assert.equal(ask.body.answer, 'Markets are up.');
    assert.equal(ask.body.speaker, 'grok');
    assert.ok(fs.readFileSync(path.join(stateDir, 'routes.jsonl'), 'utf8').includes('"speaker":"grok"'));

    assert.equal((await request(port, 'POST', '/charm/ask', { token, body: 'not json' })).status, 400);
    assert.equal((await request(port, 'POST', '/charm/ask', { token, body: { text: '  ' } })).status, 400);
    assert.equal((await request(port, 'POST', '/charm/ask', { token, body: { text: 'x'.repeat(70 * 1024) } })).status, 413);
    assert.equal((await request(port, 'GET', '/charm/sessions/..%2f..', { token })).status, 404);
  } finally {
    await server.stop();
  }
});

test('charm server: convene → council deliberates → phone approves with the token', async () => {
  const ctx = setup({ pm: [PLAN(1), LEAD_OK], eng: [SHIP], arch: [SIGNOFF] });
  const config = Object.assign(ctx.config, { charm: charmConfig().charm });
  fakeBrains(config);
  const server = new lib.CharmServer(config, { repoRoot: ctx.repo, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'charm-state-')), sessionManager: ctx.sessions, pipelineManager: ctx.pipeline });
  const port = await server.start(0, '127.0.0.1');
  const token = server.authToken;
  try {
    const convened = await request(port, 'POST', '/charm/ask', { token, body: { text: 'Convene the council to add a health check endpoint' } });
    assert.equal(convened.status, 202);
    const sid = convened.body.session.sessionId;
    assert.match(sid, /add-a-health-check-endpoint/);

    let view;
    await waitFor(async () => {
      view = (await request(port, 'GET', `/charm/sessions/${sid}`, { token })).body;
      return view.status === 'AWAITING_APPROVAL';
    });
    assert.match(view.approvalToken, /^APPROVE [0-9a-f]{8}$/);
    assert.match(view.summary, /Summary v1/);

    const second = await request(port, 'POST', '/charm/convene', { token, body: { text: 'another feature' } });
    assert.equal(second.status, 409, 'WIP limit holds');
    assert.match(second.body.error, /Queued as backlog item/);

    assert.equal((await request(port, 'POST', `/charm/sessions/${sid}/approve`, { token, body: { token: 'APPROVE 00000000' } })).status, 409);
    const ok = await request(port, 'POST', `/charm/sessions/${sid}/approve`, { token, body: { token: view.approvalToken } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'APPROVED');
    assert.equal(ok.body.executing, false);
  } finally {
    await server.stop();
  }
});

test('charm config: defaults merge and bad judge is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charm-cfg-'));
  fs.mkdirSync(path.join(dir, '.council'));
  fs.writeFileSync(path.join(dir, '.council', 'config.yml'), 'charm:\n  port: 5000\n  brains:\n    grok: { model: "grok-fast" }\n');
  const cfg = lib.loadConfig(dir);
  assert.equal(cfg.charm.port, 5000);
  assert.equal(cfg.charm.brains.grok.model, 'grok-fast');
  assert.equal(cfg.charm.brains.grok.provider, 'grok-cli');
  assert.equal(cfg.charm.routing.router.model, 'haiku');
  fs.writeFileSync(path.join(dir, '.council', 'config.yml'), 'charm:\n  panel: { judge: "bard" }\n');
  assert.throws(() => lib.loadConfig(dir), /judge/);
});

test('charm toSpeech strips markdown for reading aloud', () => {
  assert.equal(lib.toSpeech('# Hi\nSee [docs](http://x).\n```js\nx()\n```'), 'Hi\nSee docs.\n (code omitted — ask me to send it)');
});

test('charm persona is applied to every brain prompt', async () => {
  const config = charmConfig({ persona: { name: 'Pip', prompt: 'Cheerful and curious.' } });
  const fakes = fakeBrains(config, { grok: ['Hi.'] });
  await new lib.CharmBrains(config).ask('grok say hi', 'p');
  assert.match(fakes.grok.calls[0].prompt, /speak as Pip[\s\S]*Cheerful and curious/);
});
