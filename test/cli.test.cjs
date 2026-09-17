const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { makeRepo, home } = require('./helpers.cjs');

const bin = path.join(__dirname, '..', 'bin', 'councilmen.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [bin, ...args], { cwd, env: { ...process.env, COUNCILMEN_HOME: home }, encoding: 'utf8' });

test('init installs config, personas, contracts and all four standards; project standards override defaults', () => {
  const repo = makeRepo();
  const r = run(repo, 'init');
  assert.equal(r.status, 0, r.stderr);
  const dir = path.join(repo, '.councilmen');
  for (const f of ['config.yml', 'CONSTITUTION.md', 'DELEGATION.md', 'personas/lead-pm.md', 'references/review-contract.md',
    'standards/00-manifest.md', 'standards/01-architecture.md', 'standards/02-coding-practices.md', 'standards/03-documentation.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
  }
  const { loadStandards } = require('../dist/utils/prompts.js');
  fs.writeFileSync(path.join(dir, 'standards', '04-extra.md'), '# S-04 — Extra');
  assert.deepEqual(loadStandards(repo).map(s => s.file), ['00-manifest.md', '01-architecture.md', '02-coding-practices.md', '03-documentation.md', '04-extra.md']);
});

test('CLI errors are one clean line with a non-zero exit, not a stack trace', () => {
  const repo = makeRepo();
  const r = run(repo, 'approve', 'nope', 'APPROVE 00000000');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Session nope does not exist/);
  assert.doesNotMatch(r.stderr + r.stdout, /\n\s+at /);
});

test('CLI backlog add/list round-trip', () => {
  const repo = makeRepo();
  assert.equal(run(repo, 'backlog', 'add', 'Ship it', '-p', '2').status, 0);
  assert.match(run(repo, 'backlog', 'list').stdout, /001\s+todo\s+p2\s+Ship it/);
  assert.equal(run(repo, 'backlog', 'add', 'Bad', '-p', '12').status, 1);
});
