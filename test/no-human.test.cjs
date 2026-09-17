const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lib, git, setup, PLAN, SHIP, SIGNOFF, LEAD_OK, engines, revision, approvedSession, commitAndFinish } = require('./helpers.cjs');

test('undefined rule in the Lead draft is answered by the Chief Architect and shown to every later seat', async () => {
  const ctx = setup({
    pm: [`QUESTION FOR ARCHITECT: Should slugify('') throw or return ''?\n${PLAN(1)}`, LEAD_OK],
    eng: [SHIP],
    arch: ["ANSWER 1: Return '' — simplest total function.", SIGNOFF]
  });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'ask-architect', { task: 'x' });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  const rulings = ctx.sessions.loadArchitectRulings(sid);
  assert.equal(rulings.length, 1);
  assert.equal(rulings[0].askedBy, 'lead_pm');
  assert.match(rulings[0].ruling, /Return ''/);
  assert.match(ctx.adapters.arch.calls[0].options.systemPrompt, /Undefined-Rule Contract/);
  assert.match(ctx.adapters.eng.calls[0].prompt, /R1 \(asked by lead_pm.*RULING: Return ''/s);
  assert.match(ctx.adapters.arch.calls[1].prompt, /RULING: Return ''/, 'review sees the ruling');
  assert.match(ctx.adapters.pm.calls[1].prompt, /RULING: Return ''/, 'lead sign-off sees the ruling');
});

test('a Chief Engineer SHIP IT that still asks the Architect a question does not converge', async () => {
  const ctx = setup({
    pm: [PLAN(1), revision(2), LEAD_OK],
    eng: [`${SHIP}\nQUESTION FOR ARCHITECT: May tests live in a __tests__ folder?`, SHIP],
    arch: ['ANSWER 1: No — 02 Coding Practices §6 requires adjacent tests.', SIGNOFF]
  });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'eng-question', { task: 'x' });
  const result = await deliberation.run(sid);
  assert.equal(result.rounds, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.sessions.getSessionPath(sid), 'round-01', 'verdict.json'), 'utf8')).converged, false);
  assert.match(ctx.adapters.pm.calls[1].prompt, /requires adjacent tests/);
});

test('an ADVISORY concern blocks submission: zero concerns are required before the Operator sees the PRD', async () => {
  const ctx = setup({
    pm: [PLAN(1), revision(2), LEAD_OK],
    eng: [SHIP, SHIP],
    arch: ['CONCERN 1: ADVISORY — SRE — name the rollback\nVERDICT: SIGN-OFF WITH CONCERNS', SIGNOFF]
  });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'advisory', { task: 'x' });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.equal(result.rounds, 2);
  assert.equal(ctx.adapters.pm.calls.length, 3, 'lead never signed off the version that had a concern');
  assert.match(ctx.adapters.pm.calls[1].prompt, /every concern, REQUIRED or ADVISORY, must be resolved/);
  // A stated SIGN-OFF with an advisory concern listed is not a zero-concern sign-off either.
  const r = lib.parseReview('CONCERN 1: ADVISORY — x — y\nVERDICT: SIGN-OFF', 1, 'p', 'r');
  assert.equal(r.verdict, 'SIGN-OFF WITH CONCERNS');
  assert.equal(lib.isSignedOff(r), false);
});

test('lead SIGN-OFF that asks the Architect a question counts as RETHINK', () => {
  assert.equal(lib.parseLeadSignoff('VERDICT: SIGN-OFF\nQUESTION FOR ARCHITECT: is x allowed?', 1, 'p', 'r').verdict, 'RETHINK');
  assert.deepEqual(lib.extractArchitectQuestions('text.QUESTION FOR ARCHITECT 2: why?\nQUESTION FOR ARCHITECT: how?'), ['why?', 'how?']);
});

test('execution: BLOCKED.md goes to the Chief Architect and the Chief Engineer is resumed with the ruling', async () => {
  const ctx = setup();
  const { sid } = await approvedSession(ctx, 'exec-blocked');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(
    (p, o) => { fs.writeFileSync(path.join(o.cwd, 'BLOCKED.md'), 'QUESTION FOR ARCHITECT: Which file holds the helper?'); return 'blocked'; },
    commitAndFinish
  );
  ctx.adapters.arch.responses.push('ANSWER 1: Put it in feature.txt — co-locate with its only consumer.');
  const outcome = await execution.run(sid);
  assert.equal(outcome, 'BLOCKED', 'no git remote in this test, so publishing fails after verification');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /Push or pull request creation failed/);
  const calls = ctx.adapters.eng.calls;
  assert.match(calls[calls.length - 1].prompt, /RULING: Put it in feature.txt/);
  assert.equal(ctx.sessions.loadArchitectRulings(sid)[0].stage, 'execution attempt 1');
});

test('execution: failed verification is fed back to the Chief Engineer, who fixes it on the next attempt', async () => {
  const ctx = setup({ project: { test_command: 'test -f fixed.txt' } });
  const { sid } = await approvedSession(ctx, 'exec-retry');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(commitAndFinish, (p, o) => {
    fs.writeFileSync(path.join(o.cwd, 'fixed.txt'), 'ok\n');
    git(o.cwd, 'add', 'fixed.txt');
    git(o.cwd, '-c', 'user.email=e@x', '-c', 'user.name=E', 'commit', '-qm', 'fix: make tests pass');
    fs.writeFileSync(path.join(o.cwd, 'DONE.md'), 'done');
    return 'fixed';
  });
  assert.equal(await execution.run(sid), 'BLOCKED');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /Push or pull request creation failed/, 'verification passed on attempt 2');
  const calls = ctx.adapters.eng.calls;
  assert.match(calls[calls.length - 1].prompt, /Harness verification of your DONE.md failed[\s\S]*test command failed/);
});
