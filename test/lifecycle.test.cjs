const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lib, git, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, engines, revision, approvedSession, fakeGh, commitAndFinish } = require('./helpers.cjs');

test('full council: objection → revision → ratification → architect + lead sign-off → approval', async () => {
  const ctx = setup({ pm: [PLAN(1), revision(2), LEAD_OK], eng: [OBJECT, SHIP], arch: [SIGNOFF] });
  const { council, deliberation } = engines(ctx);
  const item = ctx.pipeline.addItem('Add idempotency', 1, 'Webhooks must be idempotent.');
  const sid = await council.open(ctx.repo, 'idempotency', { backlogItem: item.id });
  assert.equal(ctx.pipeline.getItem(item.id).status, 'in-council');

  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.equal(result.rounds, 2);
  assert.equal(ctx.pipeline.getItem(item.id).status, 'awaiting-approval');

  // Personas and contracts reach every seat.
  assert.match(ctx.adapters.pm.calls[0].options.systemPrompt, /Persona: Council Lead/);
  assert.match(ctx.adapters.pm.calls[0].prompt, /Webhooks must be idempotent/);
  assert.match(ctx.adapters.eng.calls[0].options.systemPrompt, /Persona: Chief Engineer/);
  assert.match(ctx.adapters.eng.calls[0].options.systemPrompt, /Chief Engineer Advisory Contract/);
  assert.equal(ctx.adapters.eng.calls[0].options.permissionMode, 'plan');
  assert.match(ctx.adapters.arch.calls[0].options.systemPrompt, /Architecture Review Contract/);
  assert.equal(ctx.adapters.arch.calls[0].options.permissionMode, undefined);
  // All four engineering standards reach every seat.
  for (const call of [ctx.adapters.pm.calls[0], ctx.adapters.eng.calls[0], ctx.adapters.arch.calls[0]]) {
    for (const marker of ['Engineering Standards — Master Manifest', 'S-01 — Architecture Standards', 'S-02 — Coding Practices', 'S-03 — Documentation Standards']) {
      assert.ok(call.options.systemPrompt.includes(marker), `missing ${marker}`);
    }
  }
  // The revision prompt carried the engineer's objection; round 2 carried the Lead's response.
  assert.match(ctx.adapters.pm.calls[1].prompt, /Missing test/);
  assert.match(ctx.adapters.eng.calls[1].prompt, /Adopted: added a test/);
  // The Lead signs off last, on the final document.
  assert.match(ctx.adapters.pm.calls[2].prompt, /Final Sign-Off/);
  assert.match(ctx.adapters.pm.calls[2].prompt, /Requirement v2/);

  const deliverable = fs.readFileSync(result.deliverable, 'utf8');
  assert.equal(deliverable, PLAN(2));
  const status = ctx.sessions.getStatus(sid);
  assert.deepEqual(status.details.signedOffBy, ['chief_engineer', 'chief_architect', 'lead_pm']);

  assert.throws(() => council.approve(sid, 'APPROVE deadbeef'), /Invalid approval token/);
  council.approve(sid, result.approvalToken);
  assert.equal(ctx.sessions.getStatus(sid).status, 'APPROVED');
  assert.equal(ctx.sessions.getStatus(sid).details.prdSha256, status.details.prdSha256);
});

test('Operator is not presented a document the Chief Architect rejected; the council revises first', async () => {
  const ctx = setup({
    pm: [PLAN(1), revision(2), LEAD_OK],
    eng: [SHIP, SHIP],
    arch: ['CONCERN 1: REQUIRED — OWASP — hardcoded secret\nVERDICT: RETHINK\nSUMMARY: no', SIGNOFF]
  });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'arch-reject', { task: 'Do a thing' });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.equal(result.rounds, 2);
  assert.match(ctx.adapters.pm.calls[1].prompt, /hardcoded secret/);
  assert.equal(ctx.adapters.pm.calls.length, 3, 'lead signs off only the architect-approved version');
});

test('Operator is not presented a document the Council Lead refuses to sign off', async () => {
  const ctx = setup({
    pm: [PLAN(1), 'VERDICT: RETHINK\nSUMMARY: scope incomplete\n1. Add rollback section', revision(2), LEAD_OK],
    eng: [SHIP, SHIP],
    arch: [SIGNOFF, SIGNOFF]
  });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'lead-reject', { task: 'Do a thing' });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.equal(result.rounds, 2);
  assert.match(ctx.adapters.pm.calls[2].prompt, /Add rollback section/);
});

test('finalize and approve refuse unless all three seats signed off the identical plan', async () => {
  const ctx = setup({ pm: [LEAD_OK], eng: [SHIP], arch: [SIGNOFF] });
  const { council } = engines(ctx);
  const signoff = new lib.LeadSignoffEngine(ctx.config, ctx.sessions);
  const review = new lib.ArchitectureReviewEngine(ctx.config, ctx.sessions);
  const sid = await council.open(ctx.repo, 'manual', { task: 'Manual flow' });

  assert.throws(() => council.finalize(sid), /No deliberation round/);
  council.saveDraft(sid, 'plan', PLAN(1));
  await council.askRound(sid, 'review please');
  assert.throws(() => council.finalize(sid), /Chief Architect has not reviewed.*Council Lead has not signed off/);
  await assert.rejects(signoff.runSignoff(sid), /signs off last/);
  await review.runReview(sid);
  assert.throws(() => council.finalize(sid), /Council Lead has not signed off/);
  await signoff.runSignoff(sid);

  // Tampering with the plan after sign-off breaks every seat's hash.
  const planFile = path.join(ctx.sessions.getSessionPath(sid), 'plan-v1.md');
  const original = fs.readFileSync(planFile, 'utf8');
  fs.writeFileSync(planFile, original + '\nsneaky change\n');
  assert.throws(() => council.finalize(sid), /changed after the Chief Engineer ratified.*different version.*different version/);
  fs.writeFileSync(planFile, original);

  const file = council.finalize(sid);
  const token = lib.approvalToken(ctx.sessions.getStatus(sid).details.prdSha256);
  // Tampering with the deliverable after finalization blocks approval.
  fs.chmodSync(file, 0o644);
  fs.appendFileSync(file, 'x');
  assert.throws(() => council.approve(sid, token), /modified after finalization/);
});

test('deadlock: tie-break from tiebreak_round, then STALLED without presenting any document or asking the Operator', async () => {
  const ctx = setup({
    pm: [PLAN(1), revision(2), revision(3)],
    eng: [OBJECT, OBJECT, OBJECT],
    arch: ['RULING 1: STANDS — tests are mandatory\nSUMMARY: adopt it'],
    council: { max_rounds: 3, tiebreak_round: 2 }
  });
  const { council, deliberation } = engines(ctx);
  const item = ctx.pipeline.addItem('Contested', 2, '');
  const sid = await council.open(ctx.repo, 'deadlock', { backlogItem: item.id });
  const result = await deliberation.run(sid);
  assert.equal(result.outcome, 'STALLED');
  assert.equal(result.rounds, 3);
  assert.equal(ctx.adapters.arch.calls.length, 1, 'tie-break runs after round 2 only; round 3 hits max_rounds');
  assert.match(ctx.adapters.pm.calls[2].prompt, /tests are mandatory/);
  assert.match(ctx.adapters.eng.calls[2].prompt, /Binding Chief Architect Rulings/);
  assert.equal(ctx.sessions.getStatus(sid).status, 'STALLED');
  assert.equal(fs.existsSync(path.join(ctx.sessions.getSessionPath(sid), 'brief-and-prd.md')), false);
  assert.equal(ctx.pipeline.getItem(item.id).status, 'parked');
});

test('WIP limit blocks a second backlog item from entering council', async () => {
  const ctx = setup();
  const { council } = engines(ctx);
  const a = ctx.pipeline.addItem('First', 1, '');
  const b = ctx.pipeline.addItem('Second', 2, '');
  await council.open(ctx.repo, 'first', { backlogItem: a.id });
  await assert.rejects(council.open(ctx.repo, 'second', { backlogItem: b.id }), /WIP limit 1 reached/);
});

test('lead PM output without the required headings is retried once, then fails loudly', async () => {
  const ctx = setup({ pm: ['just some prose', 'still prose'] });
  const { council, deliberation } = engines(ctx);
  const sid = await council.open(ctx.repo, 'bad-format', { task: 'x' });
  await assert.rejects(deliberation.run(sid), /Lead PM failed to produce a valid draft v1/);
  assert.match(ctx.adapters.pm.calls[1].prompt, /rejected by the harness/);
});

test('status details merge across transitions and legacy flat STATUS.json is readable', async () => {
  const ctx = setup();
  const { council } = engines(ctx);
  const sid = await council.open(ctx.repo, 'status', { task: 'x' });
  ctx.sessions.setStatus(sid, 'AWAITING_APPROVAL', { prdSha256: 'abc' });
  ctx.sessions.setStatus(sid, 'APPROVED', { approvedAt: 'now' });
  assert.deepEqual(ctx.sessions.getStatus(sid).details, { prdSha256: 'abc', approvedAt: 'now' });
  fs.writeFileSync(path.join(ctx.sessions.getSessionPath(sid), 'STATUS.json'), JSON.stringify({ status: 'AWAITING_APPROVAL', prdSha256: 'legacy' }));
  assert.equal(ctx.sessions.getStatus(sid).details.prdSha256, 'legacy');
  assert.throws(() => ctx.sessions.getSessionPath('../escape'), /Invalid session id/);
});
