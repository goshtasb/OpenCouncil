const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lib, setup, engines, approvedSession, commitAndFinish, fakeGh } = require('./helpers.cjs');

function gateConfig(ctx, gates, failFast) {
  ctx.config.verification = { gates, fail_fast: failFast };
  return ctx;
}

test('gates default to the project lint/test commands and are validated', () => {
  const config = JSON.parse(JSON.stringify(lib.DEFAULT_CONFIG));
  config.project.lint_command = '';
  config.project.test_command = 'npm test';
  assert.deepEqual(lib.resolveGates(config).map(g => [g.name, g.command, g.required]), [['test', 'npm test', true]]);

  config.verification = { gates: [{ name: 'sca', command: 'npm audit --audit-level=high', required: false, standard: '12-point #3' }] };
  const resolved = lib.resolveGates(config);
  assert.deepEqual(resolved.map(g => g.name), ['sca'], 'configured gates replace the implicit lint/test pair');
  assert.equal(resolved[0].required, false);

  config.verification = { gates: [{ name: 'a', command: 'true' }, { name: 'a', command: 'true' }] };
  assert.throws(() => lib.resolveGates(config), /Duplicate verification gate name 'a'/);
  config.verification = { gates: [{ name: 'b', command: '   ' }] };
  assert.throws(() => lib.resolveGates(config), /has no command/);
  config.verification = { gates: [{ name: 'c', command: 'true', timeout_seconds: 0 }] };
  assert.throws(() => lib.resolveGates(config), /non-positive timeout/);
});

test('runGates records evidence per gate, honours timeouts, and separates advisory failures', async () => {
  const gates = lib.resolveGates({
    project: {},
    verification: {
      gates: [
        { name: 'pass', command: 'echo ok', standard: '12-point #4' },
        { name: 'slow', command: 'sleep 5', timeout_seconds: 1 },
        { name: 'advisory', command: 'echo bad >&2; exit 2', required: false }
      ]
    }
  });
  const results = await lib.runGates(gates, { cwd: process.cwd() });
  assert.deepEqual(results.map(r => r.passed), [true, false, false]);
  assert.equal(results[0].standard, '12-point #4');
  assert.equal(results[1].timedOut, true);
  assert.ok(results[0].durationMs >= 0 && typeof results[0].output === 'string');
  assert.deepEqual(lib.failedRequiredGates(results).map(r => r.name), ['slow'], 'advisory failure does not block');
  assert.match(lib.describeGateFailures(results), /Gate 'slow' failed \(timed out\)/);
  assert.match(lib.summarizeGates(results), /PASS `pass`[\s\S]*FAIL `slow`[\s\S]*FAIL \(advisory\) `advisory`/);
});

test('fail_fast stops at the first failed required gate', async () => {
  const gates = lib.resolveGates({ project: {}, verification: { gates: [{ name: 'one', command: 'exit 1' }, { name: 'two', command: 'echo unreached' }] } });
  assert.deepEqual((await lib.runGates(gates, { cwd: process.cwd(), failFast: true })).map(r => r.name), ['one']);
  assert.deepEqual((await lib.runGates(gates, { cwd: process.cwd() })).map(r => r.name), ['one', 'two']);
});

test('a failed required gate blocks the pull request; an advisory failure does not', async () => {
  const blocked = gateConfig(setup({ council: { execution_attempts: 1 } }), [{ name: 'sca', command: 'exit 7', standard: '12-point #3 Software Supply Chain' }]);
  const { sid } = await approvedSession(blocked, 'gate-block');
  const engineB = engines(blocked).execution;
  await engineB.handoff(sid);
  blocked.adapters.eng.responses.push(commitAndFinish);
  assert.equal(await engineB.run(sid), 'BLOCKED');
  const reason = blocked.sessions.getStatus(sid).details.blockedReason;
  assert.match(reason, /required verification gate\(s\) failed: sca/);
  assert.match(reason, /12-point #3 Software Supply Chain/);
  const report = JSON.parse(fs.readFileSync(path.join(blocked.sessions.getSessionPath(sid), 'verification', 'latest.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.gates[0].exitCode, 7);
  assert.match(report.headSha, /^[0-9a-f]{40}$/);

  const advisory = gateConfig(setup(), [{ name: 'perf', command: 'exit 1', required: false }, { name: 'test', command: 'true' }]);
  const remote = fs.mkdtempSync(path.join(require('os').tmpdir(), 'councilmen-gate-remote-'));
  require('./helpers.cjs').git(remote, 'init', '-q', '--bare');
  require('./helpers.cjs').git(advisory.repo, 'remote', 'add', 'origin', remote);
  const { sid: sid2 } = await approvedSession(advisory, 'gate-advisory');
  const engineA = engines(advisory).execution;
  await engineA.handoff(sid2);
  advisory.adapters.eng.responses.push(commitAndFinish);
  const gh = fakeGh();
  const oldPath = process.env.PATH;
  process.env.PATH = `${gh.dir}${path.delimiter}${oldPath}`;
  try {
    assert.equal(await engineA.run(sid2), 'DONE');
  } finally {
    process.env.PATH = oldPath;
  }
  const evidence = JSON.parse(fs.readFileSync(path.join(advisory.sessions.getSessionPath(sid2), 'verification', 'latest.json'), 'utf8'));
  assert.equal(evidence.passed, true);
  assert.deepEqual(evidence.gates.map(g => [g.name, g.passed]), [['perf', false], ['test', true]]);
  // The audit trail travels with the pull request.
  assert.match(fs.readFileSync(gh.log, 'utf8'), /Harness verification/);
  assert.match(fs.readFileSync(gh.log, 'utf8'), /FAIL \(advisory\) `perf`/);
  // The pull request carries the whole audit trail: command, timing and the standard each gate enforces.
  assert.match(fs.readFileSync(gh.log, 'utf8'), /PASS `test` — `true`/);
  assert.doesNotMatch(fs.readFileSync(gh.log, 'utf8'), /see session evidence/);
  assert.equal(evidence.gates.every(g => typeof g.output === 'string'), true, 'output stays in the evidence file');
  assert.equal(advisory.sessions.getStatus(sid2).details.verification.gates.every(g => g.output === undefined), true, 'and not in status');
});

test('a malformed config fails loudly instead of silently dropping configured gates', () => {
  const fsx = require('fs');
  const osx = require('os');
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'councilmen-cfg-'));
  fsx.mkdirSync(path.join(dir, '.councilmen'));
  const write = (body) => fsx.writeFileSync(path.join(dir, '.councilmen', 'config.yml'), body);

  write('project:\n  test_command: "npm test"\nverification:\n  gates:\n    - name: "sca"\n      command: "npm audit"\n');
  assert.deepEqual(lib.loadConfig(dir).verification.gates.map(g => g.name), ['sca']);

  write('project: [this is not a mapping\n');
  assert.throws(() => lib.loadConfig(dir), /Failed to load .*config\.yml/);

  write('verification:\n  gates: "npm test"\n');
  assert.throws(() => lib.loadConfig(dir), /verification\.gates must be a list/);
});
