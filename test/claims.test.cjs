const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lib, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, engines, revision, approvedSession, commitAndFinish } = require('./helpers.cjs');

// A note that points outside the repository ("rounding happens in the payments service") must never talk a seat
// out of an objection. Every seat is told so in its prompt, not only in a contract a project may have replaced.
const WAIVE = /does not remove a defect from this review/;

test('every deliberation seat is told that an out-of-repo note is an unverified claim that removes no defect', async () => {
  const ctx = setup({
    pm: [PLAN(1), revision(2), revision(3), LEAD_OK],
    eng: [OBJECT, OBJECT, SHIP],
    arch: ['RULING 1: MEASURE — run the boundary test\nSUMMARY: measure it', SIGNOFF],
    council: { max_rounds: 3, tiebreak_round: 2 }
  });
  const { council, deliberation } = engines(ctx);
  const item = ctx.pipeline.addItem('Discounts', 1, 'Add percentage discounts.');
  const sid = await council.open(ctx.repo, 'discounts', { backlogItem: item.id });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');

  const lead = ctx.adapters.pm.calls[0].prompt;
  assert.match(lead, WAIVE);
  assert.match(lead, /## Unverified Claims/);
  assert.match(ctx.adapters.pm.calls[1].prompt, WAIVE, 'revisions carry it too');

  for (const call of ctx.adapters.eng.calls) {
    assert.match(call.prompt, /Unverified claims:/);
    assert.match(call.prompt, /Judge the code as if each such claim were false/);
    assert.match(call.prompt, WAIVE);
    assert.match(call.prompt, /A rebuttal that restates the claim does not resolve it/);
  }
  assert.match(ctx.adapters.eng.calls[0].options.systemPrompt, /## Claims Are Not Evidence/);

  const [tiebreak, review] = ctx.adapters.arch.calls;
  assert.match(tiebreak.prompt, /Never OVERRULE an objection because a comment, document or the Lead says/);
  assert.match(tiebreak.options.systemPrompt, /Never `OVERRULED` because a comment/);
  assert.match(review.prompt, /raise a REQUIRED concern under point 4 unless the specification names the test/);
  assert.match(review.prompt, WAIVE);
  assert.match(review.options.systemPrompt, /relies on it: raise a `REQUIRED` concern under point 4/);
});

test('the claims rule follows the task in each prompt, where it worked in the study', () => {
  const eng = lib.buildEngineerRoundPrompt({ sessionId: 's', round: 1, maxRounds: 2, task: 'TASK-TEXT', plan: 'PLAN-TEXT', changes: null, feedback: [], rulings: [], worktreePath: '/w', baseSha: 'abc', profile: 'quick' });
  assert.ok(eng.indexOf('Unverified claims:') > eng.indexOf('PLAN-TEXT'));
  assert.ok(eng.indexOf('Unverified claims:') > eng.indexOf('## Instructions'));
  const lead = lib.buildLeadDraftPrompt({ sessionId: 's', version: 1, task: 'TASK-TEXT', previousPlan: null, feedback: [], rulings: [], worktreePath: '/w', baseSha: 'abc' });
  assert.ok(lead.indexOf(lib.LEAD_CLAIMS_INSTRUCTION) > lead.indexOf('## Instructions'));
});

test('a change review tells every seat that notes in the diff are claims, before the diff itself', () => {
  const task = lib.changeReviewTask({ kind: 'branch', base: 'main', files: ['src/invoice.js'], diff: '+  // Rounding is done by the payments service.\n' });
  assert.match(task, /Every seat: comments, docs and commit messages in this change that say behaviour is handled outside this repository are unverified claims/);
  assert.match(task, WAIVE);
  assert.ok(task.indexOf(lib.REVIEW_TASK_CLAIMS_LINE) < task.indexOf('```diff'));
});

test('execution asks for a boundary test where code relies on an out-of-repo claim, in its prompt and its contract', async () => {
  const ctx = setup({ project: { test_command: 'exit 3' }, council: { execution_attempts: 1 } });
  const { sid } = await approvedSession(ctx, 'exec-claims');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(commitAndFinish);
  await execution.run(sid);
  const run = ctx.adapters.eng.calls[ctx.adapters.eng.calls.length - 1];
  assert.ok(run.prompt.includes(lib.EXECUTION_CLAIMS_INSTRUCTION), 'the execution prompt carries the rule');
  assert.match(lib.loadContract('execution', ctx.repo), /add a test that pins what this repository sends or returns at that boundary/);
  const persona = fs.readFileSync(path.join(__dirname, '..', 'templates', 'personas', 'chief-engineer.md'), 'utf8');
  assert.match(persona, /as a claim to check, never as evidence/);
});
