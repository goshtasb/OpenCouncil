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

const writeConfig = (repo, yml) => {
  fs.mkdirSync(path.join(repo, '.councilmen'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.councilmen', 'config.yml'), yml);
};

test('gates previews the default lint/test pair in resolution order', () => {
  const repo = makeRepo();
  writeConfig(repo, 'project:\n  lint_command: "npm run lint"\n  test_command: "npm test"\n');
  const r = run(repo, 'gates');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout,
    'lint  required  900s  02 Coding Practices  npm run lint\n' +
    'test  required  900s  12-point #4 Testing & Release Engineering  npm test\n'
  );
});

test('gates marks an advisory gate, keeps its timeout and labels a standard-less gate', () => {
  const repo = makeRepo();
  writeConfig(repo, [
    'project:',
    '  lint_command: ""',
    '  test_command: ""',
    'verification:',
    '  gates:',
    '    - name: "a11y"',
    '      command: "npm run a11y"',
    '      required: false',
    '      timeout_seconds: 120',
    '      standard: ""',
    ''
  ].join('\n'));
  const r = run(repo, 'gates');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'a11y  advisory  120s  project gate  npm run a11y\n');
});

test('gates says plainly when nothing is verified before a pull request', () => {
  const repo = makeRepo();
  writeConfig(repo, 'project:\n  lint_command: ""\n  test_command: ""\n');
  const r = run(repo, 'gates');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'No verification gates are configured. Nothing is verified before a pull request is opened.\n');
});

test('a malformed config surfaces as one clean line through the action wrapper, not a stack trace', () => {
  const repo = makeRepo();
  writeConfig(repo, 'project: [this is not a mapping\n');
  const r = run(repo, 'gates');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Failed to load .*config\.yml/);
  assert.doesNotMatch(r.stderr + r.stdout, /\n\s+at /);
});
