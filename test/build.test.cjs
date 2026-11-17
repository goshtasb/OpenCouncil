const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { lib, git, setup } = require('./helpers.cjs');

// ---------------------------------------------------------------- pure parts

test('parseRiskList reads RISK/WHEN/EXPECT/WHERE blocks with bullets, numbers and bold, and drops untestable ones', () => {
  const reply = [
    'Here is what I found.',
    '1. **RISK:** A renewal that timed out is charged again the next day',
    '   **WHEN:** renewDue runs, the gateway charges but times out, renewDue runs again tomorrow',
    '   **EXPECT:** the second run reuses the first run\'s idempotency key, so one charge in total',
    '   **WHERE:** src/renewals.js:14; docs/gateway.md:9',
    '',
    '- RISK: Declines are retried',
    '- WHEN: the gateway declines the card',
    '- EXPECT: no retry, one call',
    '',
    'RISK: vague worry with no scenario',
    'WHERE: everywhere'
  ].join('\n');
  const risks = lib.parseRiskList(reply, 5);
  assert.strictEqual(risks.length, 2);
  assert.match(risks[0].title, /renewal that timed out/);
  assert.match(risks[0].when, /renewDue runs/);
  assert.match(risks[0].expect, /reuses/);
  assert.match(risks[0].where, /renewals\.js:14/);
  assert.strictEqual(risks[1].where, '-');
  assert.strictEqual(lib.parseRiskList(reply, 1).length, 1);
  assert.ok(lib.saysNoRisks('NO RISKS'));
  assert.ok(!lib.saysNoRisks('RISK: x'));
});

test('a wrapped WHEN line is kept as part of that field', () => {
  const risks = lib.parseRiskList('RISK: double charge\nWHEN: the first call times out\n  after the gateway charged\nEXPECT: one charge\nWHERE: a.js:1', 5);
  assert.strictEqual(risks[0].when, 'the first call times out after the gateway charged');
});

test('checkLedger: a risk ends as a tagged test that ran, a rejection quoted word for word, or missing', () => {
  const risk = id => ({ id, seat: 'chief_engineer', vendor: 'Claude', round: 1, title: id, when: 'w', expect: 'e', where: '-' });
  const risks = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map(risk);
  const outcomes = lib.checkLedger({
    risks,
    ledger: [
      'R2: REJECTED: "Refunds are handled by the finance team\'s own job, never here." (docs/refunds.md)',
      'R3: REJECTED: "We will do this in a follow-up ticket next sprint" (task)',
      'R4: deferred to a follow-up',
      'R6: REJECTED: "never here" (docs/refunds.md)'
    ].join('\n'),
    testFiles: [{ path: 'test/risks.test.js', content: "test('[R1] retried renewal charges once', () => {})\ntest('[R5] other', () => {})" }],
    quotable: [{ source: 'task', text: 'Add retries.' }, { source: 'docs/refunds.md', text: "Refunds are handled by the finance\nteam's own job, never here." }],
    gateOutput: 'ok 1 - [R1] retried renewal charges once'
  });
  const by = Object.fromEntries(outcomes.map(o => [o.id, o]));
  assert.strictEqual(by.R1.status, 'tested');
  assert.deepStrictEqual(by.R1.files, ['test/risks.test.js']);
  assert.strictEqual(by.R2.status, 'rejected', 'a quote across a line break still matches');
  assert.strictEqual(by.R2.source, 'docs/refunds.md');
  assert.strictEqual(by.R3.status, 'missing', 'a quote that is not in the task or the repo is no rejection');
  assert.match(by.R3.reason, /not in the task/);
  assert.strictEqual(by.R4.status, 'missing', '"deferred" is not a way out');
  assert.strictEqual(by.R5.status, 'missing', 'a tagged test the test command never ran does not count');
  assert.match(by.R5.reason, /may not run/);
  assert.strictEqual(by.R6.status, 'missing', 'a quote too short to prove anything');
});

test('a tagged test counts when the gate output names its file rather than the test (quiet reporters)', () => {
  const [o] = lib.checkLedger({
    risks: [{ id: 'R7', seat: 'lead_pm', vendor: 'Gemini', round: 1, title: 't', when: 'w', expect: 'e', where: '-' }],
    ledger: '', testFiles: [{ path: 'test/council-risks.test.js', content: "it('[R7] x')" }], quotable: [], gateOutput: 'PASS test/council-risks.test.js'
  });
  assert.strictEqual(o.status, 'tested');
});

test('skippedTests finds skip and todo markers added to test files only', () => {
  const diff = [
    '+++ b/test/a.test.js',
    "+test.skip('[R1] x', () => {})",
    "+test('[R2] y', { skip: true }, () => {})",
    "+it('[R3] z', () => {})",
    '+++ b/src/flags.js',
    "+const config = { skip: true };",
    '+++ b/tests/test_x.py',
    '+@pytest.mark.xfail'
  ].join('\n');
  const hits = lib.skippedTests(diff);
  assert.strictEqual(hits.length, 3);
  assert.ok(hits.every(h => !h.startsWith('src/')));
});

test('ledgerTable lists every risk with who named it and how it ended', () => {
  const table = lib.ledgerTable(
    [{ id: 'R1', seat: 'chief_architect', vendor: 'Grok', round: 1, title: 'a | b', when: '', expect: '', where: '' }],
    [{ id: 'R1', status: 'tested', files: ['test/x.test.js'] }]
  );
  assert.match(table, /\| R1 \| Grok \| a \\\| b \| test in `test\/x.test.js` \|/);
});

// ---------------------------------------------------------------- the whole build, with scripted seats

// `env -u`: the project's own node --test must print plain TAP, not report into this test run.
const TEST_COMMAND = 'env -u NODE_TEST_CONTEXT node --test test/*.test.js';
const PKG = JSON.stringify({ name: 'demo', private: true, scripts: { test: 'node --test test/*.test.js' } });

function project(extra = {}) {
  const ctx = setup({ council: { execution_attempts: 2, ...extra.council }, project: { test_command: TEST_COMMAND } });
  fs.mkdirSync(path.join(ctx.repo, 'src'));
  fs.mkdirSync(path.join(ctx.repo, 'test'));
  fs.writeFileSync(path.join(ctx.repo, 'package.json'), PKG);
  fs.writeFileSync(path.join(ctx.repo, 'src', 'add.js'), 'module.exports = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(ctx.repo, 'test', 'add.test.js'), "const test = require('node:test');\nconst assert = require('assert');\nconst add = require('../src/add');\ntest('adds', () => assert.strictEqual(add(1, 2), 3));\n");
  fs.writeFileSync(path.join(ctx.repo, 'NOTES.md'), 'Amounts are whole cents and are never negative in this service.\n');
  git(ctx.repo, 'add', '.');
  git(ctx.repo, 'commit', '-qm', 'project');
  if (extra.build) ctx.config.build = extra.build;
  const sessions = new lib.SessionManager(path.join(lib.projectStateDir(ctx.repo), 'builds'));
  return { ...ctx, engine: new lib.BuildEngine(ctx.config, sessions) };
}

const commit = (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, '-c', 'user.email=e@x', '-c', 'user.name=E', 'commit', '-qm', msg); };
const write = (cwd, file, content) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), content); };
const buildSum = (prompt, o) => { write(o.cwd, 'src/sum.js', "const add = require('./add');\nmodule.exports = xs => xs.reduce(add);\n"); commit(o.cwd, 'feat: sum'); return 'built'; };
const riskTest = (ids, body = 'assert.ok(true)') => `const test = require('node:test');\nconst assert = require('assert');\n${ids.map(id => `test('[${id}] covered', () => { ${body}; });`).join('\n')}\n`;

test('council build: the builder builds, three seats name risks, every risk becomes a passing test, DONE', async () => {
  const ctx = project();
  const R = (title) => `RISK: ${title}\nWHEN: sum([])\nEXPECT: returns 0\nWHERE: src/sum.js:2`;
  ctx.adapters.eng.responses.push(
    buildSum,
    (prompt, o) => { assert.strictEqual(o.permissionMode, 'plan'); assert.match(prompt, /src\/sum\.js/); return R('empty list throws'); },
    (prompt, o) => {
      assert.match(prompt, /\[R1\]|R1/);
      assert.match(prompt, /No deferring/);
      write(o.cwd, 'src/sum.js', "const add = require('./add');\nmodule.exports = xs => xs.reduce(add, 0);\n");
      write(o.cwd, 'test/council-risks.test.js', riskTest(['R1', 'R2']));
      commit(o.cwd, 'test: council risks');
      return 'tests written';
    }
  );
  ctx.adapters.pm.responses.push((prompt, o) => { assert.strictEqual(o.permissionMode, 'plan'); return R('negative amounts'); });
  ctx.adapters.arch.responses.push('NO RISKS');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'add-sum' });
  assert.strictEqual(result.outcome, 'DONE', result.reason);
  assert.deepStrictEqual(result.risks.map(r => `${r.id} ${r.vendor === 'fake' ? '' : r.seat}`), ['R1 chief_engineer', 'R2 lead_pm']);
  assert.deepStrictEqual(result.outcomes.map(o => o.status), ['tested', 'tested']);
  assert.deepStrictEqual(result.gaps, []);
  assert.strictEqual(result.localBranch, 'council/add-sum');
  assert.match(git(ctx.repo, 'show', 'council/add-sum:src/sum.js'), /reduce\(add, 0\)/, 'the branch is in the user repo');
  assert.strictEqual(git(ctx.repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'the user checkout is untouched');
  const status = ctx.engine.sessions.getStatus(result.sessionId);
  assert.strictEqual(status.status, 'DONE');
  assert.strictEqual(status.details.tested, 2);
  assert.match(fs.readFileSync(result.report, 'utf8'), /\| R2 \|/);
});

test('council build: a risk left for "a follow-up" is fed back and must be tested before the build is done', async () => {
  const ctx = project();
  ctx.adapters.eng.responses.push(
    buildSum,
    'RISK: empty list throws\nWHEN: sum([])\nEXPECT: 0\nWHERE: src/sum.js:2',
    (prompt, o) => {
      write(o.cwd, 'test/council-risks.test.js', riskTest(['R1']));
      write(o.cwd, 'RISKS.md', 'R2: deferred, follow-up ticket\n');
      commit(o.cwd, 'test: R1 only');
      return 'done';
    },
    (prompt, o) => {
      assert.match(prompt, /R2: no test tags \[R2\]/, 'the harness says exactly what is missing');
      assert.doesNotMatch(prompt, /### R1 /, 'only the risks still owed are sent again');
      write(o.cwd, 'test/council-risks.test.js', riskTest(['R1', 'R2']));
      commit(o.cwd, 'test: R2 too');
      return 'done';
    }
  );
  ctx.adapters.pm.responses.push('RISK: negative totals\nWHEN: sum([-1])\nEXPECT: refuses\nWHERE: NOTES.md:1');
  ctx.adapters.arch.responses.push('NO RISKS');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'defer', fetchBranch: false });
  assert.strictEqual(result.outcome, 'DONE', result.reason);
  assert.strictEqual(ctx.adapters.eng.calls.length, 4);
  assert.ok(!fs.existsSync(path.join(result.worktree, 'RISKS.md')) || !git(result.worktree, 'ls-files', 'RISKS.md'), 'the ledger is never committed');
});

test('council build: a rejection must quote the task or the repository word for word', async () => {
  const ctx = project({ council: { execution_attempts: 1 } });
  ctx.adapters.eng.responses.push(
    buildSum,
    'RISK: negative totals\nWHEN: sum([-1])\nEXPECT: refuses\nWHERE: src/sum.js:2',
    (prompt, o) => { write(o.cwd, 'RISKS.md', 'R1: REJECTED: "Negative numbers are out of scope for this change entirely" (task)\n'); return 'done'; }
  );
  ctx.adapters.pm.responses.push('NO RISKS');
  ctx.adapters.arch.responses.push('NO RISKS');
  const blocked = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'fake-quote', fetchBranch: false });
  assert.strictEqual(blocked.outcome, 'BLOCKED');
  assert.match(blocked.reason, /R1: the rejection's quote/);
  assert.strictEqual(ctx.engine.sessions.getStatus(blocked.sessionId).status, 'BLOCKED');

  const ok = project({ council: { execution_attempts: 1 } });
  ok.adapters.eng.responses.push(
    buildSum,
    'RISK: negative totals\nWHEN: sum([-1])\nEXPECT: refuses\nWHERE: src/sum.js:2',
    (prompt, o) => { write(o.cwd, 'RISKS.md', 'R1: REJECTED: "Amounts are whole cents and are never negative in this service." (NOTES.md)\n'); return 'done'; }
  );
  ok.adapters.pm.responses.push('NO RISKS');
  ok.adapters.arch.responses.push('NO RISKS');
  const done = await ok.engine.run(ok.repo, { task: 'Add a sum function.', slug: 'real-quote', fetchBranch: false });
  assert.strictEqual(done.outcome, 'DONE', done.reason);
  assert.deepStrictEqual(done.outcomes.map(o => [o.status, o.source]), [['rejected', 'NOTES.md']]);
});

test('council build: skipped risk tests and a failing test command block the build', async () => {
  const ctx = project({ council: { execution_attempts: 1 } });
  ctx.adapters.eng.responses.push(
    buildSum,
    'RISK: empty list throws\nWHEN: sum([])\nEXPECT: 0\nWHERE: src/sum.js:2',
    (prompt, o) => {
      write(o.cwd, 'test/council-risks.test.js', "const test = require('node:test');\ntest.skip('[R1] empty list', () => {});\ntest('breaks', () => { throw new Error('boom'); });\n");
      commit(o.cwd, 'test');
      return 'done';
    }
  );
  ctx.adapters.pm.responses.push('NO RISKS');
  ctx.adapters.arch.responses.push('NO RISKS');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'skips', fetchBranch: false });
  assert.strictEqual(result.outcome, 'BLOCKED');
  assert.match(result.reason, /may not be skipped/);
  assert.match(result.reason, /required verification gate/);
});

test('council build: a seat that fails is a recorded gap, and the build goes on with the other seats\' risks', async () => {
  const ctx = project();
  ctx.adapters.eng.responses.push(buildSum, 'NO RISKS');
  ctx.adapters.pm.responses.push(() => { const e = new Error('agy failed'); e.stderr = 'RESOURCE_EXHAUSTED: quota'; throw e; });
  ctx.adapters.arch.responses.push('I had a look and it seems fine overall.');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'gap', fetchBranch: false });
  assert.strictEqual(result.outcome, 'DONE', result.reason);
  assert.strictEqual(result.risks.length, 0);
  assert.deepStrictEqual(result.gaps.map(g => g.seat), ['lead_pm', 'chief_architect']);
  assert.match(result.gaps[0].reason, /usage limit/);
  assert.match(result.gaps[1].reason, /without a single RISK/);
  assert.strictEqual(ctx.adapters.eng.calls.length, 2, 'no risks, gates pass: the builder is not called again');
});

test('council build: a read-only seat that edits the checkout has its edits dropped', async () => {
  const ctx = project();
  ctx.adapters.eng.responses.push(buildSum, 'NO RISKS');
  ctx.adapters.pm.responses.push((prompt, o) => { fs.writeFileSync(path.join(o.cwd, 'src', 'sum.js'), 'broken('); return 'NO RISKS'; });
  ctx.adapters.arch.responses.push('NO RISKS');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'tamper', fetchBranch: false });
  assert.strictEqual(result.outcome, 'DONE', result.reason);
  assert.match(fs.readFileSync(path.join(result.worktree, 'src', 'sum.js'), 'utf8'), /reduce/);
});

test('council build: a second risk round sends the ledger so far and stops when no new risk comes', async () => {
  const ctx = project({ build: { risk_rounds: 3 } });
  ctx.adapters.eng.responses.push(
    buildSum,
    'RISK: empty list throws\nWHEN: sum([])\nEXPECT: 0\nWHERE: src/sum.js:2',
    (prompt, o) => { write(o.cwd, 'src/sum.js', "const add = require('./add');\nmodule.exports = xs => xs.reduce(add, 0);\n"); write(o.cwd, 'test/council-risks.test.js', riskTest(['R1'])); commit(o.cwd, 'R1'); return 'ok'; },
    (prompt) => { assert.match(prompt, /R1 \(fake-eng-\d+\): empty list throws -> tested in test\/council-risks\.test\.js/); return 'NO RISKS'; }
  );
  ctx.adapters.pm.responses.push('NO RISKS', 'NO RISKS');
  ctx.adapters.arch.responses.push('NO RISKS', 'NO RISKS');
  const result = await ctx.engine.run(ctx.repo, { task: 'Add a sum function.', slug: 'rounds', fetchBranch: false });
  assert.strictEqual(result.outcome, 'DONE', result.reason);
  assert.strictEqual(ctx.adapters.pm.calls.length, 2, 'round 3 never ran');
});

test('council build refuses a project with no test command', async () => {
  const ctx = project();
  ctx.config.project.test_command = '';
  await assert.rejects(ctx.engine.run(ctx.repo, { task: 'x', slug: 'none' }), /needs a test command/);
});

test('buildSlug makes a branch-safe name from the task', () => {
  const { buildSlug } = require('../dist/commands/build.js');
  assert.strictEqual(buildSlug('Make `chargeCustomer` retry when the gateway times out!'), 'make-chargecustomer-retry-when-the');
  assert.strictEqual(buildSlug('!!!'), 'build');
});
