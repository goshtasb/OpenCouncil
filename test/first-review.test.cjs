// The first review on any setup: the setup check, running with the seats that are ready, a seat that fails mid-run,
// and the quick one-round default. Every seat is scripted; no model is called.
process.env.COUNCIL_RETRY_DELAY_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { lib, home, makeRepo, setup, ScriptedAdapter, PLAN, SHIP, SIGNOFF, LEAD_OK } = require('./helpers.cjs');

const bin = path.join(__dirname, '..', 'bin', 'council.js');

const TWO_OBJECTIONS = [
  'VERDICT: SHIP WITH CHANGES',
  'OPEN OBJECTIONS: 2',
  '',
  '1. **The retry loop never stops (src/retry.js:12).** It retries on every status, 4xx included.',
  '2. **Rename the helper (src/retry.js:3).** The name is vague.'
].join('\n');
const RULINGS = 'RULING 1: STANDS — a 400 is retried forever.\nRULING 2: OVERRULED — naming is taste.\nSUMMARY: One objection stands.';

/** The config `council review` builds for quick mode, on scripted seats. */
function quick(extra = {}) {
  return setup({ council: { max_rounds: 1, tiebreak_round: 1, signoff_revisions: 0, final_arbitration: true, profile: 'quick', seat_failover: true, failover_providers: [], ...extra } });
}

const failWith = (fields) => () => { throw Object.assign(new Error(fields.message || 'Command failed'), fields); };

test('quick review (the default): one call per seat, and the Chief Architect rules on every open objection', async () => {
  const ctx = quick();
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'while (true) retry();\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  ctx.adapters.eng.responses.push(TWO_OBJECTIONS);
  ctx.adapters.arch.responses.push(RULINGS);
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(result.outcome, 'STALLED');
  assert.equal(result.rounds, 1);
  assert.deepEqual([ctx.adapters.pm.calls.length, ctx.adapters.eng.calls.length, ctx.adapters.arch.calls.length], [1, 1, 1], 'one call per seat');
  assert.match(ctx.adapters.arch.calls[0].prompt, /^# Council Tie-Break/);
  assert.equal(result.top.length, 1, 'the overruled objection is not a finding');
  assert.equal(result.top[0].ruling, 'STANDS');
  assert.equal(result.top[0].location, 'src/retry.js:12');
  const { outcomeLine } = require('../dist/commands/review.js');
  assert.equal(outcomeLine(result, '40 s', false), 'After 1 round the Chief Engineer had 2 open objections; the Chief Architect ruled 1 upheld, 1 overruled (40 s).');
  const md = fs.readFileSync(result.mdPath, 'utf8');
  assert.match(md, /_Chief Engineer, round 1; upheld by the Chief Architect_/);
  assert.match(md, /<summary>Chief Architect's rulings on round 1: 1 upheld, 1 overruled<\/summary>/);
  const found = md.slice(md.indexOf('### What the council found'), md.indexOf('### Every round'));
  assert.match(found, /The retry loop never stops/);
  assert.doesNotMatch(found, /Rename the helper/, 'the overruled one is only in the folded rounds, not the findings');
  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), /rulings on round 1: 1 upheld, 1 overruled/);
});

test('quick review with no objections: the Architect signs off, the Lead signs off, and nothing else is spent', async () => {
  const ctx = quick();
  fs.writeFileSync(path.join(ctx.repo, 'a.js'), 'module.exports = 1;\n');
  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
  ctx.adapters.eng.responses.push(SHIP);
  ctx.adapters.arch.responses.push(SIGNOFF);
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.equal(ctx.adapters.pm.calls.length + ctx.adapters.eng.calls.length + ctx.adapters.arch.calls.length, 4);
});

test('a seat that runs out of quota mid-run is dropped, the next provider takes it, and the review notes the gap', async () => {
  const ctx = quick();
  const backup = new ScriptedAdapter('fake-backup-quota', [TWO_OBJECTIONS]);
  lib.registerAdapter(backup.name, backup);
  ctx.config.council.failover_providers = [ctx.adapters.eng.name, backup.name];
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  const quota = failWith({ exitCode: 1, command: 'fake-eng -p <a very long prompt>', message: 'Command failed with exit code 1: fake-eng -p <a very long prompt>', stderr: 'Error 429: RESOURCE_EXHAUSTED, quota exceeded for this model' });
  ctx.adapters.eng.responses.push(quota, quota);
  ctx.adapters.arch.responses.push(RULINGS);
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(result.rounds, 1);
  assert.equal(backup.calls.length, 1, 'the round went to the backup provider');
  assert.equal(ctx.config.seats.chief_engineer.provider, backup.name, 'the seat stays moved for the rest of the run');
  const record = lib.loadSeatsRecord(ctx.sessions.getSessionPath(result.sessionId));
  assert.equal(record.failures.length, 1);
  assert.equal(record.failures[0].seat, 'chief_engineer');
  assert.equal(record.failures[0].kind, 'quota');
  assert.equal(record.failures[0].stage, 'round 1');
  assert.equal(record.failures[0].replacedBy.provider, backup.name);
  assert.doesNotMatch(record.failures[0].reason, /very long prompt/, 'the command line (which carries the prompt) never lands in the record');
  assert.match(result.seats.gaps[0], /^Chief Engineer on .* hit its usage limit .* during round 1; .* took the seat\.$/);
  assert.match(fs.readFileSync(result.mdPath, 'utf8'), /\*\*Gaps in this review:\*\*\n\n- Chief Engineer on/);
  assert.match(fs.readFileSync(path.join(ctx.sessions.getSessionPath(result.sessionId), 'HISTORY.log'), 'utf8'), /Chief Engineer seat moved to/);
});

test('an Architect that stops at its turn limit with nobody to replace it: the review still ends with the objections', async () => {
  const ctx = quick();
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  ctx.adapters.eng.responses.push(TWO_OBJECTIONS);
  ctx.adapters.arch.responses.push(failWith({ exitCode: 1, stderr: 'Error: max turns reached (10)' }));
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(result.outcome, 'STALLED');
  assert.equal(result.top.length, 2, 'no rulings, so both objections stand as findings');
  assert.match(result.seats.gaps[0], /^Chief Architect on .* stopped at its turn limit .* during arbitration of round 1; nobody could take the seat, so that step was skipped\.$/);
  assert.match(result.seats.lineup, /Chief Architect: did not answer/);
});

test('a dropped provider is not called again: every seat it held moves before its next call', async () => {
  const ctx = quick();
  // Lead PM and Chief Architect share one provider; it fails on the Lead's draft.
  ctx.config.seats.chief_architect.provider = ctx.adapters.pm.name;
  const backup = new ScriptedAdapter('fake-backup-shared', [PLAN(1), RULINGS]);
  lib.registerAdapter(backup.name, backup);
  ctx.config.council.failover_providers = [backup.name];
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(failWith({ exitCode: 1, stderr: 'Not logged in. Please run /login' }));
  ctx.adapters.eng.responses.push(TWO_OBJECTIONS);
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(ctx.adapters.pm.calls.length, 1, 'tried once, then dropped');
  assert.equal(backup.calls.length, 2, 'the backup drafted and arbitrated');
  const record = lib.loadSeatsRecord(ctx.sessions.getSessionPath(result.sessionId));
  assert.equal(record.failures[0].kind, 'login');
  assert.deepEqual(record.answered.map(a => [a.seat, a.provider]), [['lead_pm', backup.name], ['chief_engineer', ctx.adapters.eng.name], ['chief_architect', backup.name]]);
});

test('when no provider is left for the Lead PM or the Chief Engineer, the run stops with a plain reason', async () => {
  const ctx = quick();
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(failWith({ exitCode: 1, stderr: 'Error 429: quota exceeded' }), failWith({ exitCode: 1, stderr: 'Error 429: quota exceeded' }));
  await assert.rejects(lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline }), /No provider is left for the Lead PM seat: .* hit its usage limit/);
});

test('without seat_failover a failing seat ends the run exactly as before', async () => {
  const ctx = setup();
  ctx.adapters.pm.responses.push(failWith({ exitCode: 1, stderr: 'boom' }));
  const { council, deliberation } = { council: new lib.CouncilEngine(ctx.config, ctx.sessions, ctx.pipeline), deliberation: new lib.DeliberationEngine(ctx.config, ctx.sessions, ctx.pipeline) };
  const sid = await council.open(ctx.repo, 'no-failover', { task: 'do a thing' });
  await assert.rejects(deliberation.run(sid), /Command failed/);
});

test('describeSeatError names the failure in one line and never repeats the command line', () => {
  const command = 'agy -p ' + 'PROMPT '.repeat(200);
  const quota = lib.describeSeatError({ command, message: `Command failed with exit code 1: ${command}`, stderr: 'RESOURCE_EXHAUSTED: 429', exitCode: 1 });
  assert.equal(quota.kind, 'quota');
  assert.doesNotMatch(quota.reason, /PROMPT/);
  assert.equal(lib.describeSeatError({ timedOut: true, command, message: command }).kind, 'timeout');
  assert.equal(lib.describeSeatError({ stderr: 'Invalid API key · Please run /login' }).kind, 'login');
  assert.equal(lib.describeSeatError({ stdout: 'max turns reached' }).kind, 'max-turns');
  assert.equal(lib.describeSeatError({ exitCode: 2 }).reason, 'exited with code 2');
});

function replayWith(answered) {
  return { task: 'Review this change before it ships.\n...', rounds: [{ n: 1, engineer: { reply: '', openObjections: 1 } }], seats: { planned: {}, answered, failures: [] } };
}
const top = [{ round: 1, seat: 'Chief Engineer', headline: 'Off by one.', evidence: '', location: 'a.js:3', ruling: 'STANDS' }];

test('the share line names the vendors that answered, and says so plainly when there was only one', () => {
  const three = replayWith([
    { seat: 'lead_pm', provider: 'antigravity', model: 'gemini-4-argon-high' },
    { seat: 'chief_engineer', provider: 'claude-code', model: 'opus' },
    { seat: 'chief_architect', provider: 'grok-cli', model: 'grok-4.6' }
  ]);
  assert.equal(lib.shareLine(three, top), 'I had Gemini, Claude and Grok review my change before shipping it. First objection, from the Chief Engineer, upheld by the Chief Architect: "Off by one" (a.js:3). Try it on yours: npx open-council-cli review');
  const solo = replayWith([
    { seat: 'lead_pm', provider: 'claude-code', model: 'sonnet' },
    { seat: 'chief_engineer', provider: 'claude-code', model: 'opus' },
    { seat: 'chief_architect', provider: 'claude-code', model: 'sonnet' }
  ]);
  const line = lib.shareLine(solo, top);
  assert.match(line, /^I had three Claude seats \(sonnet and opus\) review my change/);
  assert.doesNotMatch(line, /Gemini|Grok|three AI/);
  assert.match(lib.seatSummary(solo).lineup, /^Claude only \(single vendor\): Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet\.$/);
  const two = replayWith([{ seat: 'lead_pm', provider: 'claude-code', model: 'sonnet' }, { seat: 'chief_engineer', provider: 'claude-code', model: 'opus' }, { seat: 'chief_architect', provider: 'grok-cli', model: 'grok-4.6' }]);
  assert.match(lib.shareLine(two, []), /^Claude and Grok reviewed my change and found nothing/);
});

test('describeLineup says single vendor for a Claude-only plan and names each vendor otherwise', () => {
  const solo = lib.describeLineup(lib.planSeats(new Set(['claude-code'])).seats);
  assert.equal(solo.singleVendor, true);
  assert.equal(solo.label, 'Claude only (single vendor)');
  assert.equal(solo.seats, 'Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet');
  const full = lib.describeLineup(lib.planSeats(new Set(['claude-code', 'antigravity', 'grok-cli'])).seats);
  assert.equal(full.label, 'Gemini, Claude and Grok');
});

test('the default review is quick: one round, final arbitration, no revision rounds, failover across the ready seats', async () => {
  const repo = makeRepo();
  const { config, plan, notes } = await lib.reviewConfig(repo, undefined, new Set(['grok-cli', 'claude-code']));
  assert.equal(config.council.max_rounds, 1);
  assert.equal(config.council.tiebreak_round, 1);
  assert.equal(config.council.signoff_revisions, 0);
  assert.equal(config.council.final_arbitration, true);
  assert.equal(config.council.seat_failover, true);
  assert.deepEqual(config.council.failover_providers, ['claude-code', 'grok-cli']);
  assert.equal(plan.seats.chief_architect.provider, 'grok-cli');
  assert.deepEqual(notes, []);
  const debate = await lib.reviewConfig(repo, lib.REVIEW_DEBATE_ROUNDS, new Set(['claude-code']));
  assert.equal(debate.config.council.max_rounds, 2);
  assert.equal(debate.config.council.signoff_revisions, 1);
  assert.equal(debate.config.council.final_arbitration, false);
});

test('a project config whose seat is not ready gets a ready provider for this review, and the file is untouched', async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.council'));
  const configFile = path.join(repo, '.council', 'config.yml');
  fs.writeFileSync(configFile, 'seats:\n  lead_pm:\n    provider: "antigravity"\n    model: "gemini-4-argon-high"\n  chief_engineer:\n    provider: "claude-code"\n    model: "opus"\n  chief_architect:\n    provider: "grok-cli"\n    model: "grok-4.6"\n');
  const before = fs.readFileSync(configFile, 'utf8');
  const { config, notes } = await lib.reviewConfig(repo, 1, new Set(['claude-code', 'grok-cli']));
  assert.equal(config.seats.lead_pm.provider, 'claude-code');
  assert.equal(config.seats.lead_pm.model, 'sonnet');
  assert.equal(config.seats.chief_architect.provider, 'grok-cli');
  assert.match(notes[0], /^Lead PM: Gemini \(agy\) is not ready, so Claude \(sonnet\) takes the seat for this review\./);
  assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});

/** Registers scripted adapters under the real provider ids, so preflight checks them. Separate test files run in separate processes. */
function fakeProvider(id, { installed = true, reply = 'PONG', error } = {}) {
  const adapter = {
    name: id,
    canDisableTools: id !== 'antigravity',
    calls: [],
    async isAvailable() { return installed; },
    async runPrompt(prompt, options) { this.calls.push({ prompt, options }); if (error) throw Object.assign(new Error('Command failed'), error); return reply; }
  };
  lib.registerAdapter(id, adapter);
  return adapter;
}

test('preflight asks each installed CLI one word, in an empty directory, and gives the fix for each one that is not ready', async () => {
  const claude = fakeProvider('claude-code');
  const agy = fakeProvider('antigravity', { error: { exitCode: 1, stderr: 'Error 429: RESOURCE_EXHAUSTED' } });
  const grok = fakeProvider('grok-cli', { installed: false });
  fakeProvider('gemini-cli', { installed: false });
  const checks = await lib.preflight();
  assert.deepEqual(checks.map(c => [c.provider, c.status]), [['claude-code', 'ready'], ['antigravity', 'quota'], ['grok-cli', 'not-installed']]);
  assert.equal(claude.calls[0].prompt, lib.PING_PROMPT);
  assert.equal(claude.calls[0].options.model, 'haiku');
  assert.equal(claude.calls[0].options.permissionMode, undefined, 'the check runs with no tools');
  assert.equal(fs.existsSync(claude.calls[0].options.cwd), false, 'the scratch directory is gone afterwards');
  assert.equal(agy.calls[0].options.model, lib.DEFAULT_MODELS.antigravity, 'Gemini is asked on the model the review will use, because its quota is per model');
  assert.equal(grok.calls.length, 0, 'nothing is asked of a CLI that is not installed');
  assert.deepEqual(lib.readyProviders(checks), ['claude-code']);
  const lines = lib.formatChecks(checks).join('\n');
  assert.match(lines, /✓ Claude\s+ready/);
  assert.match(lines, /✗ Gemini \(agy\)\s+usage limit reached/);
  assert.match(lines, /✗ Grok\s+not installed[^\n]*\n\s+fix: curl -fsSL https:\/\/x\.ai\/cli\/install\.sh \| bash  then  grok login/);
  const plan = lib.planSeats(new Set(lib.readyProviders(checks)));
  assert.deepEqual(lib.lineupLines(plan, checks), [
    'Claude only (single vendor): Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet.',
    'For a cross-vendor council, fix Gemini (agy) and Grok above. This review runs without them.'
  ]);
  assert.deepEqual((await lib.preflight({ ping: false })).map(c => c.status), ['unchecked', 'unchecked', 'not-installed']);
});

/** A stand-in `claude` CLI: answers --version, the setup check, and each council prompt by its heading. */
function fakeClaudeOnPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fake-claude-'));
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  fs.symlinkSync(process.execPath, path.join(dir, 'node'));
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const model = args[args.indexOf('--model') + 1];
require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls.log'))}, model + '\\n');
let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  if (/PONG/.test(input)) return console.log('PONG');
  if (/^# Council Draft/.test(input)) return console.log(${JSON.stringify(PLAN(1))});
  if (/^# Council Round/.test(input)) return console.log(${JSON.stringify(TWO_OBJECTIONS)});
  if (/^# Council Tie-Break/.test(input)) return console.log(${JSON.stringify(RULINGS)});
  console.error('unexpected prompt: ' + input.slice(0, 80)); process.exit(1);
});
`;
  fs.writeFileSync(path.join(dir, 'claude'), script, { mode: 0o755 });
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'council-empty-home-'));
  const env = { ...process.env, COUNCIL_HOME: home, PATH: dir, HOME: emptyHome, USERPROFILE: emptyHome, COUNCIL_RETRY_DELAY_MS: '0' };
  delete env.GROK_BIN;
  delete env.ANTHROPIC_API_KEY;
  return { dir, env };
}

test('council doctor with no project config checks every seat CLI and says who a review would seat', () => {
  const { env } = fakeClaudeOnPath();
  const r = spawnSync(process.execPath, [bin, 'doctor'], { cwd: makeRepo(), env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ Claude\s+ready/);
  assert.match(r.stdout, /✗ Gemini \(agy\)\s+not installed[^\n]*\n\s+fix: curl -fsSL https:\/\/antigravity\.google\/cli\/install\.sh \| bash/);
  assert.match(r.stdout, /A review here would seat Claude only \(single vendor\): Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet\./);
  assert.match(r.stdout, /For a cross-vendor council, fix Gemini \(agy\) and Grok above\./);
});

test('npx open-council-cli review with only Claude signed in: a labelled single-vendor review, one call per seat', () => {
  const { dir, env } = fakeClaudeOnPath();
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'retry.js'), 'while (true) retry();\n');
  const out = path.join(repo, '..', path.basename(repo) + '-out');
  const r = spawnSync(process.execPath, [bin, 'review', '--no-open', '--out', out], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Seats: Claude only \(single vendor\): Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet\./);
  assert.match(r.stdout, /Quick review: one round, one call per seat\./);
  assert.match(r.stdout, /the Chief Architect ruled 1 upheld, 1 overruled/);
  assert.match(r.stdout, /I had three Claude seats \(sonnet and opus\) review my change/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n'), ['haiku', 'sonnet', 'opus', 'sonnet'], 'the check, then one call per seat');
  const md = fs.readFileSync(path.join(out, 'review.md'), 'utf8');
  assert.match(md, /^Seats: Claude only \(single vendor\)/m);
  assert.doesNotMatch(md, /Gemini|Grok/);
});
