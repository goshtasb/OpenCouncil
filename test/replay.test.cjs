const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeRepo, home } = require('./helpers.cjs');
const lib = require('../dist/index.js');

const bin = path.join(__dirname, '..', 'bin', 'council.js');
const run = (cwd, ...args) => spawnSync(process.execPath, [bin, ...args], { cwd, env: { ...process.env, COUNCIL_HOME: home }, encoding: 'utf8' });
const demoDir = path.join(__dirname, '..', 'demo', 'slugify-empty-and-accents');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'council-replay-'));

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    if (fs.statSync(from).isDirectory()) copyTree(from, path.join(dest, name));
    else fs.copyFileSync(from, path.join(dest, name));
  }
}

test('demo plays the recorded run at once when piped: task, the Node 22 objection, sign-off, gate and outcome', () => {
  const r = run(tmp(), 'demo');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\u001b\[/, 'no colour codes when stdout is not a terminal');
  assert.match(r.stdout, /No models are called/);
  assert.match(r.stdout, /slugify\(''\) throws/);
  assert.match(r.stdout, /Round 1: SHIP WITH CHANGES, 1 open objection/);
  assert.match(r.stdout, /npm test\s+already fails at the baseline|npm test already fails at the baseline/);
  assert.match(r.stdout, /Final sign-off on v4: SIGN-OFF/);
  assert.match(r.stdout, /APPROVE 47d99f76/);
  assert.match(r.stdout, /test: npm test\s+PASS \(7 of 7 tests pass, 0 fail\)/);
  assert.match(r.stdout, /Outcome: BLOCKED/);
  assert.match(r.stdout, /instead of claiming DONE/);
  // Commits print oldest first: the test-script fix came before the slug fix.
  assert.ok(r.stdout.indexOf('a0b2282') < r.stdout.indexOf('1dab67c'));
});

test('demo works outside a git repository, with no .council config', () => {
  const dir = tmp();
  const r = run(dir, 'demo', '--fast');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, '.council')));
});

test('demo --html writes one self-contained page with every reply and no local paths', () => {
  const dir = tmp();
  const r = run(dir, 'demo', '--html');
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'council-demo.html'), 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Council replay: slugify-empty-and-accents<\/title>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\b(src|href)="(?!https:\/\/github\.com\/goshtasb\/OpenCouncil")/, 'no external or local resources');
  assert.doesNotMatch(html, /\/root\/|\/tmp\/|\/Users\//);
  for (const n of [1, 2, 3, 4]) assert.match(html, new RegExp(`<h2>Round ${n}</h2>`));
  assert.match(html, /MODULE_NOT_FOUND/);
  assert.match(html, /<h2>Why it ended BLOCKED<\/h2>/);

  const custom = run(dir, 'demo', '--html', 'out/page.html');
  assert.equal(custom.status, 0, custom.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'page.html')));
});

test('replay writes a session as HTML by session id or by directory, and plays it with --play', () => {
  const repo = makeRepo();
  // The CLI keys state by git's top-level path, which is /private/var/... on macOS where the temp dir is /var/...
  const sessions = path.join(lib.projectStateDir(lib.resolveRepoRoot(repo)), 'sessions');
  copyTree(demoDir, path.join(sessions, '20261106190450-slugify-empty-and-accents'));

  const byId = run(repo, 'replay', '20261106190450-slugify-empty-and-accents');
  assert.equal(byId.status, 0, byId.stderr);
  const page = path.join(repo, '20261106190450-slugify-empty-and-accents.html');
  assert.match(fs.readFileSync(page, 'utf8'), /Outcome: BLOCKED/);

  const out = path.join(tmp(), 'r.html');
  const byDir = run(tmp(), 'replay', demoDir, '--out', out);
  assert.equal(byDir.status, 0, byDir.stderr);
  assert.ok(fs.existsSync(out));

  const play = run(repo, 'replay', '20261106190450-slugify-empty-and-accents', '--play');
  assert.equal(play.status, 0, play.stderr);
  assert.match(play.stdout, /Outcome: BLOCKED/);
});

test('replay of an unknown session is one clean error line', () => {
  const r = run(makeRepo(), 'replay', 'nope');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Session nope does not exist/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('replay of a stalled session shows what the harness kept and no sign-off', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: 's-stalled', slug: 'stalled', baseSha: 'abc1234', maxRounds: 4, profile: 'quick' }));
  fs.writeFileSync(path.join(dir, 'STATUS.json'), JSON.stringify({ status: 'STALLED' }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'Do the thing.');
  fs.writeFileSync(path.join(dir, 'plan-v1.md'), '# Plan\n\nStep one.');
  fs.mkdirSync(path.join(dir, 'round-01'));
  fs.writeFileSync(path.join(dir, 'round-01', 'reply.md'), 'VERDICT: DO NOT SHIP\n\n1. **The plan names a file that does not exist.** `src/x.ts` is missing.\n');
  fs.writeFileSync(path.join(dir, 'round-01', 'verdict.json'), JSON.stringify({ verdict: 'DO NOT SHIP', openObjections: 1 }));
  fs.writeFileSync(path.join(dir, 'stalled-draft-and-objections.md'), '## Open objections\n\n- the missing file');

  const replay = lib.loadSessionReplay(dir);
  assert.equal(replay.status, 'STALLED');
  const html = lib.renderReplayHtml(replay);
  assert.match(html, /Stalled: what the harness kept/);
  assert.doesNotMatch(html, /The signed-off PRD/);
  const text = lib.buildBeats(replay).map(b => [b.headline, ...b.lines].join('\n')).join('\n');
  assert.match(text, /STALLED/);
  assert.match(text, /The plan names a file that does not exist/);
  assert.doesNotMatch(text, /Outcome: STALLED/, 'the stall beat is the outcome; it is not repeated');
});

test('renderMarkdown escapes HTML in seat replies and renders the markup seats use', () => {
  const html = lib.renderMarkdown('<script>alert(1)</script>\n\n**bold** and `<b>code</b>` and [link](https://example.com) and [bad](javascript:alert(1))\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n  - nested\n- two\n\n```js\nconst x = "<y>";\n```');
  assert.doesNotMatch(html, /<script>|<b>code/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>&lt;b&gt;code&lt;\/b&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/example.com" rel="noopener noreferrer">link<\/a>/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<table>.*<th>a<\/th>.*<td>2<\/td>/s);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code class="lang-js">const x = &quot;&lt;y&gt;&quot;;<\/code><\/pre>/);
});

test('scrub shortens home and council paths so a replay can be shared', () => {
  assert.equal(lib.scrub('/root/.council/projects/x'), '~/.council/projects/x');
  assert.equal(lib.scrub('/Users/ana/.council/p'), '~/.council/p');
  assert.equal(lib.scrub('see /home/ana/code/repo'), 'see ~/code/repo');
});

test('the demo session ships in the npm package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('demo'));
  for (const f of ['meta.json', 'HISTORY.log', 'STATUS.json', 'task.md']) assert.ok(fs.existsSync(path.join(demoDir, f)), `missing ${f}`);
  const tracked = require('child_process').execFileSync('git', ['ls-files', 'demo'], { cwd: path.join(__dirname, '..') }).toString();
  assert.match(tracked, /HISTORY\.log/, 'HISTORY.log must be committed, or the demo loses its timeline');
  const all = [];
  const walk = d => fs.readdirSync(d).forEach(n => { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : all.push(fs.readFileSync(p, 'utf8')); });
  walk(demoDir);
  assert.doesNotMatch(all.join('\n'), /\/root\/|\/tmp\/claude|\/home\/[a-z]/, 'no machine paths in the shipped recording');
});
