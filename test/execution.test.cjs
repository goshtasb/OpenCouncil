const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lib, git, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, engines, revision, approvedSession, fakeGh, commitAndFinish } = require('./helpers.cjs');

test('execution: handoff → autonomous run → tests → push → PR → DONE', async () => {
  const ctx = setup();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'councilmen-remote-'));
  git(remote, 'init', '-q', '--bare');
  git(ctx.repo, 'remote', 'add', 'origin', remote);
  const { sid, item } = await approvedSession(ctx, 'exec-ok');
  const { execution } = engines(ctx);

  const clone = await execution.handoff(sid);
  assert.equal(git(clone, 'branch', '--show-current'), 'council/exec-ok');
  assert.equal(ctx.pipeline.getItem(item.id).status, 'in-execution');

  ctx.adapters.eng.responses.push(commitAndFinish);
  const gh = fakeGh();
  const oldPath = process.env.PATH;
  process.env.PATH = `${gh.dir}${path.delimiter}${oldPath}`;
  try {
    assert.equal(await execution.run(sid), 'DONE');
  } finally {
    process.env.PATH = oldPath;
  }
  const execCall = ctx.adapters.eng.calls[ctx.adapters.eng.calls.length - 1];
  assert.equal(execCall.options.permissionMode, 'auto');
  assert.match(execCall.options.systemPrompt, /Autonomous Execution Contract/);
  assert.match(git(remote, 'log', '--oneline', 'council/exec-ok'), /feat: implement/);
  assert.match(fs.readFileSync(gh.log, 'utf8'), /pr create --base main --head council\/exec-ok/);
  const status = ctx.sessions.getStatus(sid);
  assert.equal(status.status, 'DONE');
  assert.equal(status.details.prUrl, 'https://github.com/example/repo/pull/1');
  assert.equal(ctx.pipeline.getItem(item.id).status, 'done');
});

test('execution: failing tests are BLOCKED, never reported as DONE', async () => {
  const ctx = setup({ project: { test_command: 'exit 3' }, council: { execution_attempts: 1 } });
  const { sid, item } = await approvedSession(ctx, 'exec-red');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(commitAndFinish);
  assert.equal(await execution.run(sid), 'BLOCKED');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /required verification gate\(s\) failed: test/);
  assert.equal(ctx.pipeline.getItem(item.id).status, 'parked');
});

test('execution: push failure (no remote) is BLOCKED, never reported as DONE', async () => {
  const ctx = setup();
  const { sid } = await approvedSession(ctx, 'exec-nopush');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(commitAndFinish);
  assert.equal(await execution.run(sid), 'BLOCKED');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /Push or pull request creation failed/);
});

test('execution: DONE.md without commits is BLOCKED once attempts are exhausted', async () => {
  const ctx = setup({ council: { execution_attempts: 1 } });
  const { sid } = await approvedSession(ctx, 'exec-empty');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push((p, o) => { fs.writeFileSync(path.join(o.cwd, 'DONE.md'), 'done'); return 'ok'; });
  assert.equal(await execution.run(sid), 'BLOCKED');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /no commits/);
});

test('execution: files created by the install step do not block; --skip-agent re-verifies without calling the agent', async () => {
  const ctx = setup({ project: { install_command: 'echo generated > install-artifact.txt', test_command: 'exit 1' }, council: { execution_attempts: 1 } });
  const { sid } = await approvedSession(ctx, 'exec-install');
  const { execution } = engines(ctx);
  await execution.handoff(sid);
  ctx.adapters.eng.responses.push(commitAndFinish);
  assert.equal(await execution.run(sid), 'BLOCKED');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /gate\(s\) failed: test/, 'install artifact was not treated as uncommitted work');

  ctx.config.project.test_command = 'true';
  const callsBefore = ctx.adapters.eng.calls.length;
  assert.equal(await execution.run(sid, { skipAgent: true }), 'BLOCKED');
  assert.equal(ctx.adapters.eng.calls.length, callsBefore, 'agent not called again');
  assert.match(ctx.sessions.getStatus(sid).details.blockedReason, /Push or pull request creation failed/);
  await assert.rejects(execution.run(sid), /Cannot run session in status 'BLOCKED'/);
});
