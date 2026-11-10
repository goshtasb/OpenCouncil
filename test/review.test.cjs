const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { lib, home, git, makeRepo, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, revision } = require('./helpers.cjs');

const bin = path.join(__dirname, '..', 'bin', 'council.js');
const fixture = path.join(__dirname, 'fixtures', 'slugify-empty-and-accents');

test('detectGates reads the package manager and scripts, and skips npm\'s placeholder test script', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.deepEqual(lib.detectGates(repo), { install: 'npm install', test: '', lint: '', source: 'package.json' });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }));
  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), '');
  assert.deepEqual(lib.detectGates(repo), { install: 'pnpm install', test: 'pnpm test', lint: 'pnpm run lint', source: 'package.json' });
  const rust = makeRepo();
  fs.writeFileSync(path.join(rust, 'Cargo.toml'), '[package]\nname="x"\n');
  assert.equal(lib.detectGates(rust).test, 'cargo test');
  assert.equal(lib.detectGates(makeRepo()).source, 'nothing recognised');
});

test('collectChange takes uncommitted edits and new files first, then the branch since its base, else nothing', () => {
  const repo = makeRepo();
  assert.equal(lib.collectChange(repo), null, 'a clean main with no remote has nothing to review');

  fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');
  fs.writeFileSync(path.join(repo, 'new.js'), 'module.exports = 1;\n');
  const dirty = lib.collectChange(repo);
  assert.equal(dirty.kind, 'uncommitted');
  assert.deepEqual(dirty.files.sort(), ['README.md', 'new.js']);
  assert.match(dirty.diff, /\+more/);
  assert.match(dirty.diff, /\+module\.exports = 1;/);

  git(repo, 'checkout', '-qb', 'feature');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'feature');
  const branch = lib.collectChange(repo);
  assert.equal(branch.kind, 'branch');
  assert.equal(branch.base, 'main');
  assert.deepEqual(branch.files.sort(), ['README.md', 'new.js']);
  assert.throws(() => lib.collectChange(repo, 'no-such-ref'), /Unknown base 'no-such-ref'/);
});

test('reviewConfig plans seats from what is installed, writes nothing, and cuts the round budget', async () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const { config, plan, gates } = await lib.reviewConfig(repo, 3, new Set(['claude-code']));
  assert.equal(plan.mode, 'solo');
  assert.equal(config.seats.chief_engineer.provider, 'claude-code');
  assert.equal(config.project.test_command, 'npm test');
  assert.equal(gates.source, 'package.json');
  assert.equal(config.council.profile, 'quick');
  assert.equal(config.council.max_rounds, 3);
  assert.equal(config.council.tiebreak_round, 2);
  assert.ok(!fs.existsSync(path.join(repo, '.council')), 'a review leaves no config behind');
  assert.equal(config.council.final_arbitration, false, 'a debate keeps its old shape');
  await assert.rejects(lib.reviewConfig(repo, 3, new Set()), /No AI CLI is ready to hold a seat.*claude\.ai\/install\.sh/s);
});

test('the change task quotes the whole diff and tells the seats whether the checkout has it', () => {
  const task = lib.changeReviewTask({ kind: 'uncommitted', base: 'HEAD', files: ['a.js'], diff: '+x\n' });
  assert.match(task, /^Review this change before it ships\./);
  assert.match(task, /not applied to it/);
  assert.match(task, /```diff\n\+x\n```/);
  assert.match(lib.changeReviewTask({ kind: 'branch', base: 'origin/main', files: ['a.js'], diff: '+x' }), /diff from origin\/main/);
});

test('topObjections leads with the Chief Engineer\'s file:line objections, earliest round first, no repeats', () => {
  const replay = lib.loadSessionReplay(fixture);
  const top = lib.topObjections(replay);
  assert.equal(top.length, 3);
  assert.match(top[0].headline, /npm test` already fails at the baseline/);
  assert.equal(top[0].location, 'package.json:8');
  assert.equal(top[0].round, 1);
  assert.ok(top.every(o => o.seat === 'Chief Engineer'));
  assert.equal(new Set(top.map(o => o.headline)).size, 3);
  const share = lib.shareLine(replay, top);
  assert.match(share, /First objection, from the Chief Engineer: "The regression gate .* already fails at the baseline" \(package\.json:8\)\. Try it on yours: npx open-council-cli review$/);
  assert.doesNotMatch(share, /\*\*|`/);
});

test('the review page and Markdown lead with what the council found and the share line, before the rounds', () => {
  const replay = lib.loadSessionReplay(fixture);
  const top = lib.topObjections(replay);
  const share = lib.shareLine(replay, top);
  const html = lib.renderReplayHtml(replay, { top, share });
  assert.ok(html.indexOf('What the council found') < html.indexOf('<h2>Round 1</h2>'));
  assert.match(html, /objection 1, round 1 · package\.json:8/);
  assert.match(html, /<textarea readonly[^>]*>I had three AI seats/);
  assert.doesNotMatch(html, /<script/i);
  const md = lib.renderReplayMarkdown(replay, { top, share });
  assert.match(md, /^## Council review: slugify-empty-and-accents/);
  assert.ok(md.indexOf('### What the council found') < md.indexOf('### Every round'));
  assert.match(md, /1\. \*\*The regression gate.*\*\* \(`package\.json:8`\)/);
  assert.match(md, /<summary>Chief Engineer, round 1: SHIP WITH CHANGES<\/summary>/);
  assert.match(md, /npx open-council-cli review<\/code><\/sub>\n$/);
});

test('runReview argues over an uncommitted change and writes both pages without touching the repo', async () => {
  const ctx = setup({ council: { max_rounds: 3, tiebreak_round: 2 } });
  fs.writeFileSync(path.join(ctx.repo, 'login.js'), 'export const login = () => true;\n');
  fs.writeFileSync(path.join(ctx.repo, '.env'), 'API_KEY=do-not-send\n');
  const state = () => [git(ctx.repo, 'status', '--porcelain'), git(ctx.repo, 'for-each-ref'), git(ctx.repo, 'worktree', 'list')].join('\n---\n');
  const before = state();
  ctx.adapters.pm.responses.push(PLAN(1), revision(2), LEAD_OK);
  ctx.adapters.eng.responses.push(OBJECT, SHIP);
  ctx.adapters.arch.responses.push(SIGNOFF);
  let seen;
  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline, onSession: (id, mode, change) => { seen = { id, mode, files: change.files }; } });
  assert.equal(result.outcome, 'AWAITING_APPROVAL');
  assert.deepEqual(seen, { id: result.sessionId, mode: 'uncommitted', files: ['login.js'] });
  assert.doesNotMatch(ctx.adapters.pm.calls[0].prompt, /do-not-send/, 'a file that looks like a secret never reaches a seat');
  assert.deepEqual(lib.collectChange(ctx.repo).withheld, ['.env']);
  assert.match(ctx.adapters.pm.calls[0].prompt, /\+export const login = \(\) => true;/, 'the diff reaches the seats');
  assert.equal(result.top.length, 1);
  assert.equal(result.top[0].headline, 'Missing test (README.md:1).');
  assert.equal(result.top[0].location, 'README.md:1');
  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), /What the council found/);
  assert.match(fs.readFileSync(result.mdPath, 'utf8'), /Missing test/);
  assert.equal(state(), before, 'status, refs and worktrees are exactly as they were');
});

test('runReview with a task reviews the plan; with nothing to review or a huge diff it says what to do', async () => {
  const ctx = setup();
  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
  ctx.adapters.eng.responses.push(SHIP);
  ctx.adapters.arch.responses.push(SIGNOFF);
  const result = await lib.runReview(ctx.repo, { task: 'add rate limiting to login', config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.match(result.sessionId, /review-add-rate-limiting-to-login$/);
  assert.equal(result.top.length, 0);
  assert.match(result.share, /reviewed my plan and found nothing to object to/);

  await assert.rejects(lib.runReview(makeRepo(), { config: ctx.config }), /Nothing to review.*council review "/s);
  const big = makeRepo();
  fs.writeFileSync(path.join(big, 'big.txt'), 'x'.repeat(lib.MAX_REVIEW_DIFF_BYTES + 10));
  await assert.rejects(lib.runReview(big, { config: ctx.config }), /more than one review can argue about well/);
});

test('council review outside a git repo, or with no AI CLI on PATH, is one clean line', () => {
  // No AI CLI may be reachable, even on a developer machine that has them installed:
  // - PATH holds only node and git (claude often sits next to node, e.g. /opt/homebrew/bin).
  // - git is a wrapper that execs the real binary by absolute path, because on macOS /usr/bin/git
  //   is an xcrun shim that does not work from a symlink in a bare PATH.
  // - HOME is empty and GROK_BIN is unset, because the Grok adapter also looks in ~/.grok/bin.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bare-path-'));
  fs.symlinkSync(process.execPath, path.join(bare, 'node'));
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bare, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'council-empty-home-'));
  const env = { ...process.env, COUNCIL_HOME: home, PATH: bare, HOME: emptyHome, USERPROFILE: emptyHome };
  delete env.GROK_BIN;
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'council-norepo-'));
  const a = spawnSync(process.execPath, [bin, 'review'], { cwd: notRepo, env, encoding: 'utf8' });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /runs inside a git repository/, `stderr was: ${a.stderr}`);
  const repo = makeRepo();
  fs.appendFileSync(path.join(repo, 'README.md'), 'x\n');
  const b = spawnSync(process.execPath, [bin, 'review'], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(b.status, 1);
  assert.match(b.stderr, /No AI CLI is ready to hold a seat/, `stderr was: ${b.stderr}`);
  assert.match(b.stdout, /✗ Claude\s+not installed/, 'the setup check names each missing CLI');
  assert.match(b.stdout, /fix: curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash  then  claude auth login/);
  assert.doesNotMatch(b.stderr, /\n\s+at /);
  assert.ok(!fs.existsSync(path.join(repo, '.council')));
});

test('a review uses a worktree of its own, so a session already open on the repo keeps its checkout', async () => {
  const ctx = setup();
  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
  ctx.adapters.eng.responses.push(SHIP);
  ctx.adapters.arch.responses.push(SIGNOFF);
  const first = await new lib.CouncilEngine(ctx.config, ctx.sessions, ctx.pipeline).open(ctx.repo, 'running', { task: 'x' });
  const shared = ctx.sessions.loadMeta(first).worktreePath;
  fs.writeFileSync(path.join(shared, 'seat-scratch.txt'), 'a seat is reading here');
  git(ctx.repo, 'commit', '-q', '--allow-empty', '-m', 'moves HEAD');
  await lib.runReview(ctx.repo, { task: 'review something', config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
  assert.ok(fs.existsSync(path.join(shared, 'seat-scratch.txt')), 'the running session\'s worktree was not reset');
  assert.doesNotMatch(git(ctx.repo, 'worktree', 'list'), /review-worktrees/);
});

test('--rounds takes 1 to 4 and nothing else', async () => {
  const repo = makeRepo();
  const found = new Set(['claude-code']);
  assert.equal((await lib.reviewConfig(repo, 1, found)).config.council.max_rounds, 1);
  assert.equal((await lib.reviewConfig(repo, 2, found)).config.council.max_rounds, 2);
  assert.equal((await lib.reviewConfig(repo, 4, found)).config.council.max_rounds, 4);
  for (const bad of [0, 5, 10, NaN, 2.5]) await assert.rejects(lib.reviewConfig(repo, bad, found), /--rounds takes a whole number from 1 to 4/);
});

test('the old council review <session> still runs the Chief Architect review and says it moved', () => {
  const repo = makeRepo();
  const env = { ...process.env, COUNCIL_HOME: home };
  const sessions = path.join(lib.projectStateDir(lib.resolveRepoRoot(repo)), 'sessions');
  const id = '20261106190450-slugify-empty-and-accents';
  require('fs').cpSync(fixture, path.join(sessions, id), { recursive: true });
  // The fixture session is BLOCKED, so both forms stop before any seat is called; what matters is the routing.
  const oldForm = spawnSync(process.execPath, [bin, 'review', id], { cwd: repo, env, encoding: 'utf8' });
  const newForm = spawnSync(process.execPath, [bin, 'architect-review', id], { cwd: repo, env, encoding: 'utf8' });
  assert.match(oldForm.stderr, /`council review <session>` is now `council architect-review <session>`.*0\.4\.0/);
  assert.equal(oldForm.status, 1);
  assert.equal(newForm.status, 1);
  assert.match(newForm.stderr, /Cannot review: session .* is 'BLOCKED'/);
  assert.equal(oldForm.stdout, newForm.stdout);
  assert.equal(oldForm.stderr.replace(/^.*architect-review <session>`.*\n/m, ''), newForm.stderr);
});
