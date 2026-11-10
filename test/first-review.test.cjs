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
  assert.equal(result.verdict.verdict, 'CHANGES REQUESTED');
  assert.equal(outcomeLine(result, '40 s', false), 'CHANGES REQUESTED after 1 round (40 s): 1 objection stands; the Chief Architect overruled 1 objection.');
  assert.match(fs.readFileSync(result.mdPath, 'utf8'), /^Outcome: \*\*CHANGES REQUESTED\*\* after 1 round: 1 objection stands/m);
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
  two.rounds[0].engineer.openObjections = 0;
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
  assert.equal(debate.config.council.final_arbitration, true, 'a debate also ends on the Architect\'s rulings');
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

test('failover never reaches an AI the config does not name: Gemini ready but unnamed gets nothing', async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.council'));
  fs.writeFileSync(path.join(repo, '.council', 'config.yml'), 'seats:\n  lead_pm:\n    provider: "claude-code"\n    model: "sonnet"\n  chief_engineer:\n    provider: "claude-code"\n    model: "opus"\n  chief_architect:\n    provider: "grok-cli"\n    model: "grok-4.6"\n');
  const ready = new Set(['claude-code', 'grok-cli', 'antigravity']);
  const { config } = await lib.reviewConfig(repo, 1, ready);
  assert.deepEqual(config.council.failover_providers, ['claude-code', 'grok-cli'], 'agy is ready but the config never named it');
  fs.writeFileSync(path.join(repo, '.council', 'config.yml'), 'council:\n  failover_providers: ["grok-cli", "antigravity", "claude-code"]\nseats:\n  lead_pm:\n    provider: "claude-code"\n    model: "sonnet"\n');
  const listed = await lib.reviewConfig(repo, 1, ready);
  assert.deepEqual(listed.config.council.failover_providers, ['grok-cli', 'antigravity', 'claude-code'], 'council.failover_providers widens it, in its own order');
  fs.writeFileSync(path.join(repo, '.council', 'config.yml'), 'council:\n  failover_providers: ["grok-cli"]\nseats:\n  lead_pm:\n    provider: "claude-code"\n    model: "sonnet"\n  chief_engineer:\n    provider: "claude-code"\n    model: "opus"\n  chief_architect:\n    provider: "claude-code"\n    model: "sonnet"\n');
  const added = await lib.reviewConfig(repo, 1, new Set(['claude-code']));
  assert.deepEqual(added.config.council.failover_providers, ['claude-code'], 'the list adds to the seats\' own AIs; it never takes them away');
});

test('without a config, failover stays on the AIs the Seats line shows', async () => {
  const repo = makeRepo();
  const { config } = await lib.reviewConfig(repo, 1, new Set(['claude-code', 'antigravity', 'gemini-cli']));
  assert.ok(!config.council.failover_providers.includes('gemini-cli'), 'gemini-cli is ready but holds no seat, so it gets no diff');
  assert.deepEqual(config.council.failover_providers, ['claude-code', 'antigravity']);
});

test('a configured seat whose replacement is not ready either says it runs without that seat, not that someone took it', async () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.council'));
  fs.writeFileSync(path.join(repo, '.council', 'config.yml'), 'seats:\n  lead_pm:\n    provider: "antigravity"\n    model: "gemini-4-argon-high"\n  chief_engineer:\n    provider: "antigravity"\n    model: "gemini-4-argon-high"\n  chief_architect:\n    provider: "grok-cli"\n    model: "grok-4.6"\n');
  const { config, notes } = await lib.reviewConfig(repo, 1, new Set(['antigravity']));
  assert.equal(config.seats.chief_architect.provider, 'grok-cli', 'no ready AI in the config can hold it with tools off, so it is not moved');
  assert.match(notes.join('\n'), /^Chief Architect: Grok is not ready, and no other AI that \.council\/config\.yml names can hold the seat with its tools off, so this review runs without it\./m);
  assert.doesNotMatch(notes.join('\n'), /takes the seat/);
  await assert.rejects(lib.reviewConfig(repo, 1, new Set(['claude-code'])), /None of the AIs \.council\/config\.yml names \(Gemini \(agy\) and Grok\) is ready/);
});

test('a usage limit on Claude opus drops only opus: the Engineer moves to sonnet before leaving Claude', () => {
  const quota = { seat: 'chief_engineer', provider: 'claude-code', model: 'opus', kind: 'quota' };
  assert.equal(lib.isDropped({ failures: [quota] }, 'claude-code', 'opus'), true);
  assert.equal(lib.isDropped({ failures: [quota] }, 'claude-code', 'sonnet'), false);
  const login = { ...quota, kind: 'login' };
  assert.equal(lib.isDropped({ failures: [login] }, 'claude-code', 'sonnet'), true, 'a lost login drops every Claude model');
  const grokQuota = { seat: 'chief_architect', provider: 'grok-cli', model: 'grok-4.6', kind: 'quota' };
  assert.equal(lib.isDropped({ failures: [grokQuota] }, 'grok-cli', 'grok-other'), true, 'a usage limit elsewhere drops the provider');
  assert.deepEqual(lib.failoverModels('claude-code', 'chief_engineer', lib.DEFAULT_MODELS), ['opus', 'sonnet']);
});

test('when the Chief Architect overrules every objection, the review says none stands instead of calling it clean or broken', async () => {
  const ctx = quick();
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  ctx.adapters.eng.responses.push(TWO_OBJECTIONS);
  ctx.adapters.arch.responses.push('RULING 1: OVERRULED — a 400 is not retried.\nRULING 2: OVERRULED — naming is taste.\nSUMMARY: Nothing stands.');
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.equal(result.top.length, 0);
  const md = fs.readFileSync(result.mdPath, 'utf8');
  assert.equal(result.verdict.verdict, 'PASS', 'nothing blocking is left, so the review passes');
  assert.match(md, /Outcome: \*\*PASS\*\* after 1 round: no blocking objection; the Chief Architect overruled 2 objections/);
  assert.doesNotMatch(md, /STALLED/);
  assert.match(md, /The Chief Engineer raised 2 objections and the Chief Architect overruled every one, so none stands\./);
  assert.doesNotMatch(md, /raised no objections|would not ship as is/);
  assert.match(result.share, /the Chief Engineer objected 2 times and the Chief Architect overruled every one/);
  assert.doesNotMatch(result.share, /nothing to object to/);
  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), /overruled every one, so none stands/);
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
  assert.match(r.stdout, /CHANGES REQUESTED after 1 round \([^)]*all on one vendor\): 1 objection stands/);
  assert.match(r.stdout, /I had three Claude seats \(sonnet and opus\) review my change/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n'), ['haiku', 'sonnet', 'opus', 'sonnet'], 'the check, then one call per seat');
  const md = fs.readFileSync(path.join(out, 'review.md'), 'utf8');
  assert.match(md, /^Seats: Claude only \(single vendor\)/m);
  assert.doesNotMatch(md, /Gemini|Grok/);
});

test('a Claude Engineer that hits its opus limit moves to sonnet before any other listed AI', async () => {
  const ctx = quick();
  const other = new ScriptedAdapter('fake-listed-first', [TWO_OBJECTIONS]);
  lib.registerAdapter(other.name, other);
  const claude = {
    name: 'claude-code', canDisableTools: true, calls: [],
    async isAvailable() { return true; },
    async runPrompt(prompt, options) {
      this.calls.push(options.model);
      if (options.model === 'opus') throw Object.assign(new Error('Command failed'), { exitCode: 1, stderr: 'Claude usage limit reached for Opus' });
      return TWO_OBJECTIONS;
    }
  };
  lib.registerAdapter('claude-code', claude);
  ctx.config.seats.chief_engineer = { ...ctx.config.seats.chief_engineer, provider: 'claude-code', model: 'opus' };
  ctx.config.council.failover_providers = [other.name, 'claude-code'];
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  ctx.adapters.arch.responses.push(RULINGS);
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.deepEqual(claude.calls, ['opus', 'sonnet']);
  assert.equal(other.calls.length, 0, 'the other AI is not reached while Claude has a model left');
  assert.deepEqual(ctx.config.seats.chief_engineer, { ...ctx.config.seats.chief_engineer, provider: 'claude-code', model: 'sonnet' });
  assert.match(result.seats.gaps[0], /^Chief Engineer on Claude \(opus\) hit its usage limit/);
});

test('in a debate, "no objection stands" is only said when nothing made the found list', () => {
  const replay = { slug: 's', status: 'STALLED', profile: 'quick', baseSha: 'abcdef1234', task: 't', rounds: [
    { n: 1, engineer: { reply: 'x', verdict: 'SHIP WITH CHANGES' }, tiebreak: { reply: 'r', rulings: [{ n: 1, ruling: 'STANDS' }] } },
    { n: 2, engineer: { reply: 'y', verdict: 'SHIP WITH CHANGES' }, tiebreak: { reply: 'r', rulings: [{ n: 1, ruling: 'OVERRULED' }] } }
  ] };
  const top = [{ round: 1, seat: 'Chief Engineer', headline: 'Upheld in round 1', ruling: 'STANDS' }];
  const md = lib.renderReplayMarkdown(replay, { top, rounds: false });
  assert.match(md, /would not ship as is/);
  assert.doesNotMatch(md, /no objection stands/);
  assert.match(lib.renderReplayMarkdown(replay, { top: [], rounds: false }), /no objection stands \(the Chief Architect overruled the only one\)/);
});

test('the seat keeps its own provider first even when council.failover_providers leaves it out', async () => {
  const ctx = quick();
  const other = new ScriptedAdapter('fake-only-listed', [TWO_OBJECTIONS]);
  lib.registerAdapter(other.name, other);
  const calls = [];
  lib.registerAdapter('claude-code', {
    name: 'claude-code', canDisableTools: true,
    async isAvailable() { return true; },
    async runPrompt(prompt, options) { calls.push(options.model); if (options.model === 'opus') throw Object.assign(new Error('Command failed'), { exitCode: 1, stderr: 'usage limit reached' }); return TWO_OBJECTIONS; }
  });
  ctx.config.seats.chief_engineer = { ...ctx.config.seats.chief_engineer, provider: 'claude-code', model: 'opus' };
  ctx.config.council.failover_providers = [other.name];
  fs.writeFileSync(path.join(ctx.repo, 'retry.js'), 'x\n');
  ctx.adapters.pm.responses.push(PLAN(1));
  ctx.adapters.arch.responses.push(RULINGS);
  await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.deepEqual(calls, ['opus', 'sonnet']);
  assert.equal(other.calls.length, 0);
});

test('a model reply that talks about login code is not read as a lost login', () => {
  assert.notEqual(lib.describeSeatError({ exitCode: 1, stdout: 'The sign in route returns 403 when the session has expired; log in is handled in auth.ts.' }).kind, 'login');
  assert.equal(lib.describeSeatError({ exitCode: 1, stdout: 'Invalid API key · Please run /login' }).kind, 'login');
  assert.equal(lib.describeSeatError({ exitCode: 1, stderr: 'Error: OAuth token has expired. Please obtain a new token or refresh your existing token.' }).kind, 'login');
  assert.equal(lib.describeSeatError({ exitCode: 1, stderr: 'API Error: 401 {"type":"error"}' }).kind, 'login');
  for (const stderr of ['Please log in to continue', 'Error: 403 PERMISSION_DENIED', 'Your session has expired', 'Authentication required']) {
    assert.equal(lib.describeSeatError({ exitCode: 1, stderr }).kind, 'login', stderr);
  }
  const model = 'The sign in route returns 403 when the session has expired; log in is handled in auth.ts.';
  assert.notEqual(lib.describeSeatError({ exitCode: 1, stdout: model, shortMessage: 'Command failed with exit code 1: agy -p x', message: `Command failed with exit code 1: agy -p x\n\n${model}`, command: 'agy -p x' }).kind, 'login', 'execa repeats stdout in message; that is not the CLI speaking');
});

test('the Action maps a seat that is not signed in to its "rejected the login" error (the grep in action.yml, run as written)', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');
  const m = yml.match(/if grep -qiE '([^']+)' "\$OUT\.log"; then\n\s*echo "::error title=Open Council::A seat rejected the login/);
  assert.ok(m, 'action.yml still greps the review log for a rejected login');
  const reason = lib.describeSeatError({ exitCode: 1, stdout: 'Invalid API key · Please run /login' }).reason;
  const failure = { seat: 'lead_pm', provider: 'claude-code', model: 'sonnet', stage: 'draft v1', kind: 'login', reason, at: '' };
  const lines = [new lib.SeatUnavailableError('lead_pm', [failure]).message];
  for (const line of lines) {
    const r = spawnSync('grep', ['-qiE', m[1]], { input: line + '\n' });
    assert.equal(r.status, 0, `grep matches: ${line}`);
  }
  assert.equal(spawnSync('grep', ['-qiE', m[1]], { input: 'No provider is left for the Chief Engineer seat: Claude hit its usage limit.\n' }).status, 1, 'a usage limit is not called a rejected login');
});

test('review --no-check still stops up front when the config names only AIs that are not installed', () => {
  const { env } = fakeClaudeOnPath();
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, '.council'));
  fs.writeFileSync(path.join(repo, '.council', 'config.yml'), 'seats:\n  lead_pm:\n    provider: "antigravity"\n    model: "gemini-4-argon-high"\n  chief_engineer:\n    provider: "grok-cli"\n    model: "grok-4.6"\n  chief_architect:\n    provider: "grok-cli"\n    model: "grok-4.6"\n');
  fs.writeFileSync(path.join(repo, 'retry.js'), 'x\n');
  const r = spawnSync(process.execPath, [bin, 'review', '--no-check', '--no-open'], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /None of the AIs \.council\/config\.yml names \(Gemini \(agy\) and Grok\) is ready/);
});
