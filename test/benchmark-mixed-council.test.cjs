// The 10-PR benchmark's harness (benchmarks/mixed-council-2026-11): the Lead PM model swap in run.sh's
// preflight, and how summarize.cjs reports a batch whose Lead PM changed part-way. Runs with stub CLIs; no
// model is called and nothing leaves the machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BENCH = path.join(__dirname, '..', 'benchmarks', 'mixed-council-2026-11');
const { tasks } = require(path.join(BENCH, 'tasks.json'));
const [A, B] = tasks;
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// ------------------------------------------------------------------ summarize.cjs
function writeRun(res, task, arm, n, { hit, lead, leadFile }) {
  const d = path.join(res, task.id, `${arm}-${n}`);
  fs.mkdirSync(d, { recursive: true });
  const found = {};
  let cf = 0;
  for (const g of task.golden) {
    const f = Boolean(hit && g.core);
    found[g.id] = { found: f, core: g.core, severity: g.severity || 'High', sections: f ? ['s1'] : [], quote: f ? 'quoted' : '' };
    if (f) cf++;
  }
  const core = task.golden.filter(g => g.core).length;
  fs.writeFileSync(path.join(d, 'score.json'), JSON.stringify({ status: 'OK', found, core_found: cf, core_total: core, core_found_blocking: 0, all_found: cf, all_total: task.golden.length, distinct_problems_raised: 3, review_chars: 100 }));
  fs.writeFileSync(path.join(d, 'seconds'), '60');
  if (lead) fs.writeFileSync(path.join(d, 'calls.jsonl'), JSON.stringify({ vendor: 'gemini', model: lead, seconds: 1, code: 0 }) + '\n');
  if (leadFile) fs.writeFileSync(path.join(d, 'lead-model'), leadFile + '\n');
}

function summarize(setupFn) {
  const root = tmp('bench-sum-');
  const res = path.join(root, 'results');
  fs.mkdirSync(res);
  setupFn(res);
  execFileSync('node', [path.join(BENCH, 'lib', 'summarize.cjs'), res, BENCH], { stdio: 'pipe' });
  return fs.readFileSync(path.join(root, 'summary.md'), 'utf8');
}

test('summarize: a batch on one Lead PM model has no per-model section', () => {
  const md = summarize(res => {
    writeRun(res, A, 'mixed', 1, { hit: true, lead: 'gemini-4-argon-high' });
    writeRun(res, A, 'single', 1, { hit: true });
  });
  assert.doesNotMatch(md, /## Mixed arm by Lead PM model/);
  assert.doesNotMatch(md, /## Deviations/);
  assert.match(md, /mixed 1 \(Lead PM gemini-4-argon-high\)/);
});

test('summarize: after a swap each Lead PM model is compared with the single agent on its own tasks only', () => {
  const nA = A.golden.filter(g => g.core).length, nB = B.golden.filter(g => g.core).length;
  const md = summarize(res => {
    // Task A ran before the swap: pre-registered model (read from its Gemini calls); the single agent finds everything.
    writeRun(res, A, 'mixed', 1, { hit: true, lead: 'gemini-4-argon-high' });
    writeRun(res, A, 'single', 1, { hit: true });
    // Task B ran after it: swapped model (read from lead-model, no Gemini calls logged); the single agent finds nothing.
    writeRun(res, B, 'mixed', 1, { hit: false, leadFile: 'gemini-3.8-flash-high' });
    writeRun(res, B, 'single', 1, { hit: false });
    fs.writeFileSync(path.join(res, 'meta.txt'), 'pre-registered lead (mixed): gemini-4-argon-high\n');
    fs.writeFileSync(path.join(res, 'deviations.txt'), '2026-11-15 10:00 PST: Lead PM (mixed arm) is gemini-3.8-flash-high for runs from now on\n');
    fs.writeFileSync(path.join(res, 'kept-check.txt'), 'Check of runs\n\n1 of 1 judged runs kept; 0 set aside to re-run.\n');
  });
  assert.match(md, /## Deviations from the pre-registration\n\n- 2026-11-15 10:00 PST: Lead PM \(mixed arm\) is gemini-3\.8-flash-high/);
  assert.match(md, /Check of runs judged before the checkout fix: 1 of 1 judged runs kept/);
  // Pre-registered model first, and its single-agent side is task A only (all found), not A and B pooled.
  const pre = md.match(/- \*\*Lead PM gemini-4-argon-high \(pre-registered\)\*\*, 1 run: (.*)/);
  assert.ok(pre, md);
  assert.match(pre[1], new RegExp(`mixed@gemini-4-argon-high ${nA}/${nA} \\(100%\\) vs single ${nA}/${nA} \\(100%\\)`));
  const swapped = md.match(/- \*\*Lead PM gemini-3\.8-flash-high\*\*, 1 run: (.*)/);
  assert.ok(swapped, md);
  assert.match(swapped[1], new RegExp(`mixed@gemini-3\\.8-flash-high 0/${nB} \\(0%\\) vs single 0/${nB} \\(0%\\)`));
  assert.ok(md.indexOf('(pre-registered)') < md.indexOf('Lead PM gemini-3.8-flash-high**'));
  // The pooled primary line is still there, unchanged in method.
  assert.match(md, new RegExp(`- mixed ${nA}/${nA + nB} .* vs single ${nA}/${nA + nB} `));
});

// ------------------------------------------------------------------ run.sh preflight
const hasPerl = spawnSync('perl', ['-e', '1']).status === 0;

function stubs(dir, { down = [] } = {}) {
  const bin = path.join(dir, 'fake');
  fs.mkdirSync(bin);
  const w = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  w('agy', `[ "$1" = --version ] && { echo "agy 0"; exit 0; }
[ "$1" = models ] && { printf 'Available models:\\n  gemini-4-argon-high (default)\\n  gemini-3.8-flash-high\\n  gemini-3.8-flash-low\\n  gemini-3.1-pro-high\\n'; exit 0; }
m=""; prev=""; for a in "$@"; do [ "$prev" = --model ] && m=$a; prev=$a; done
case " ${down.join(' ')} " in *" $m "*) echo "Individual quota reached for $m. Resets in 151h" >&2; exit 1;; esac
echo ok`);
  w('claude', `[ "$1" = --version ] && { echo "0 (Claude Code)"; exit 0; }
echo '{"type":"result","is_error":false,"result":"ok","modelUsage":{"claude-opus":{}}}'`);
  w('grok', `[ "$1" = --version ] && { echo "grok 0"; exit 0; }
[ "$1" = models ] && { echo grok-4.7; exit 0; }
echo ok`);
  // Stand-in for open-council-cli 0.3.2, so the preflight's `council doctor` passes without a download.
  const tool = path.join(dir, 'root', 'tool', 'node_modules', 'open-council-cli');
  fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tool, 'package.json'), JSON.stringify({ name: 'open-council-cli', version: '0.3.2' }));
  fs.writeFileSync(path.join(tool, 'bin', 'council.js'), 'console.log("all seats answer");\n');
  return bin;
}

function preflight(env, down) {
  const dir = tmp('bench-pre-');
  const bin = stubs(dir, { down });
  const r = spawnSync('bash', [path.join(BENCH, 'run.sh')], {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, BENCH_ROOT: path.join(dir, 'root'), GROK_BIN: path.join(bin, 'grok'), PREFLIGHT_ONLY: '1', ...env },
    encoding: 'utf8', timeout: 120000
  });
  const res = path.join(dir, 'root', 'results');
  const read = f => { try { return fs.readFileSync(path.join(res, f), 'utf8'); } catch { return ''; } };
  return { code: r.status, out: r.stdout + r.stderr, meta: read('meta.txt'), dev: read('deviations.txt') };
}
const CANDS = 'gemini-4-argon-high gemini-3.8-flash-high auto';

test('preflight: the pre-registered Lead PM is used when it answers, with no deviation', { skip: !hasPerl && 'needs perl' }, () => {
  const r = preflight({ LEAD_CANDIDATES: CANDS }, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.meta, /^lead \(mixed\): gemini-4-argon-high$/m);
  assert.match(r.meta, /^judges: claude gemini /m);
  assert.equal(r.dev, '');
});

test('preflight: out of quota, the Lead PM swaps to the next candidate and the Gemini judge is skipped, both logged', { skip: !hasPerl && 'needs perl' }, () => {
  const r = preflight({ LEAD_CANDIDATES: CANDS }, ['gemini-4-argon-high']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.meta, /^lead \(mixed\): gemini-3\.8-flash-high$/m);
  assert.match(r.meta, /^pre-registered lead \(mixed\): gemini-4-argon-high$/m);
  assert.match(r.meta, /^judges: claude \(claude = opus, gemini = gemini-4-argon-high\)$/m, 'the judge is skipped, not swapped');
  assert.match(r.dev, /Lead PM \(mixed arm\) is gemini-3\.8-flash-high for runs from now on/);
  assert.match(r.dev, /Gemini cross-check judge \(gemini-4-argon-high\) did not answer/);
});

test('preflight: "auto" falls through to another listed model, never the retired id', { skip: !hasPerl && 'needs perl' }, () => {
  const r = preflight({ LEAD_CANDIDATES: CANDS }, ['gemini-4-argon-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low']);
  assert.notEqual(r.code, 0, 'no usable model left: gemini-3.1-pro-high is retired and must not be tried');
  assert.doesNotMatch(r.out, /gemini-3\.1-pro-high ->/);
  assert.match(r.out, /No Lead PM model answered/);
  const r2 = preflight({ LEAD_CANDIDATES: CANDS }, ['gemini-4-argon-high', 'gemini-3.8-flash-high']);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.meta, /^lead \(mixed\): gemini-3\.8-flash-low$/m);
});

test('preflight: with no candidates given it only tries the pre-registered model, as before', { skip: !hasPerl && 'needs perl' }, () => {
  const r = preflight({}, ['gemini-4-argon-high']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /No Lead PM model answered; gemini-4-argon-high: Individual quota reached/);
  assert.doesNotMatch(r.out, /flash/);
});

// ------------------------------------------------------------------ fixture.sh: no background gc in the cache
test('fixture: the shared cache has git auto-gc off, so a detached gc cannot delete objects mid-clone', () => {
  const dir = tmp('bench-fx-');
  const src = path.join(dir, 'src');
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'gc.auto=0', ...a], { cwd, stdio: 'pipe' }).toString().trim();
  fs.mkdirSync(src);
  g(src, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(src, 'a.txt'), 'one\n');
  g(src, 'add', '-A'); g(src, 'commit', '-qm', 'base');
  const base = g(src, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(src, 'a.txt'), 'two\n');
  g(src, 'add', '-A'); g(src, 'commit', '-qm', 'head');
  const head = g(src, 'rev-parse', 'HEAD');
  g(src, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const tasksFile = path.join(dir, 'tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify({ tasks: [{ id: 't1', title: 'One', source: { repo: `file://${src}`, base_sha: base, head_sha: head } }] }));
  const cache = path.join(dir, 'cache');
  execFileSync('bash', [path.join(BENCH, 'lib', 'fixture.sh'), tasksFile, 't1', cache, path.join(dir, 'app')], { stdio: 'pipe' });
  assert.equal(g(path.join(cache, 'templates', 't1'), 'config', 'gc.auto'), '0');
  assert.equal(execFileSync('git', ['-C', path.join(cache, 'src.git'), 'config', 'gc.auto']).toString().trim(), '0');
  assert.equal(g(path.join(dir, 'app'), 'diff', '--name-only', 'main...HEAD'), 'a.txt');
});

// ------------------------------------------------------------------ run.sh: a sign-in prompt from Antigravity is caught
function agyShim() {
  const dir = tmp('bench-signin-');
  const bin = stubs(dir);
  // Preflight writes the logging shims into <root>/bin.
  const r = spawnSync('bash', [path.join(BENCH, 'run.sh')], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, BENCH_ROOT: path.join(dir, 'root'), GROK_BIN: path.join(bin, 'grok'), PREFLIGHT_ONLY: '1' }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = path.join(dir, 'run');
  fs.mkdirSync(out);
  return { dir, bin, out, shim: path.join(dir, 'root', 'bin', 'agy'), env: { ...process.env, BENCH_CALLS_LOG: path.join(out, 'calls.jsonl') } };
}
const signinRe = () => execFileSync('bash', ['-c', `. "$1"; printf %s "$SIGNIN_RE"`, '_', path.join(BENCH, 'lib', 'classify.sh')]).toString();
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('an agy that waits at a sign-in prompt: the prompt is logged as it arrives, and killing the shim stops agy too', { skip: !hasPerl && 'needs perl' }, async () => {
  const s = agyShim();
  const pidFile = path.join(s.dir, 'agy.pid');
  fs.writeFileSync(path.join(s.bin, 'agy'), `#!/bin/bash\necho $$ > "${pidFile}"\necho "Go to https://accounts.google.com/o/oauth2/auth?x=1 and paste the code here:" >&2\nexec sleep 60\n`);
  const { spawn } = require('child_process');
  // The council runs the shim through execa with a timeout, which sends SIGTERM to the shim alone.
  const child = spawn(s.shim, ['-p', 'hello', '--model', 'm'], { env: s.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const log = path.join(s.out, 'agy-stderr.log');
  for (let i = 0; i < 100 && !(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('paste the code')); i++) await new Promise(r => setTimeout(r, 100));
  assert.match(fs.readFileSync(log, 'utf8'), /paste the code/, 'logged while agy is still waiting');
  const agyPid = Number(fs.readFileSync(pidFile, 'utf8'));
  child.kill('SIGTERM');
  const code = await new Promise(r => child.on('close', c => r(c)));
  assert.equal(code, 143);
  for (let i = 0; i < 50 && alive(agyPid); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(alive(agyPid), false, 'agy is not left running');
  assert.match(stderr, /accounts\.google\.com/, 'stderr still reaches the council');
  assert.equal(spawnSync('grep', ['-qiE', signinRe(), log]).status, 0);
});

test('an agy that answers normally: stdout is not logged, so review text about OAuth is not a sign-in prompt', { skip: !hasPerl && 'needs perl' }, () => {
  const s = agyShim();
  fs.writeFileSync(path.join(s.bin, 'agy'), '#!/bin/bash\necho "The OAuth authorization code is not checked against accounts.google.com state."\n');
  const r = spawnSync(s.shim, ['-p', 'hello'], { env: s.env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /authorization code/);
  const log = path.join(s.out, 'agy-stderr.log');
  assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', '');
  assert.match(fs.readFileSync(path.join(s.out, 'calls.jsonl'), 'utf8'), /"vendor":"gemini".*"code":0/);
});

test('classify_failure: a sign-in prompt stops the batch as SIGNIN; a usage limit as LIMIT; anything else carries on', () => {
  const classify = (files, code) => {
    const out = tmp('bench-cls-');
    const res = tmp('bench-res-');
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(out, f), body);
    const st = execFileSync('bash', ['-c', '. "$1"; classify_failure "$2" "$3" "$4"', '_', path.join(BENCH, 'lib', 'classify.sh'), out, String(code), res]).toString().trim();
    const stop = fs.existsSync(path.join(res, 'STOP')) ? fs.readFileSync(path.join(res, 'STOP'), 'utf8') : null;
    return { st, stop };
  };
  assert.deepEqual(classify({ 'cli.log': 'Timed out\n', 'agy-stderr.log': 'Paste this code into your application to complete authentication:\n' }, 1), { st: 'SIGNIN', stop: 'signin\n' });
  assert.deepEqual(classify({ 'cli.log': 'Error 429: quota exceeded\n' }, 1), { st: 'LIMIT', stop: '' });
  assert.deepEqual(classify({ 'cli.log': 'Timed out\n' }, 1), { st: 'ERROR', stop: null });
  assert.deepEqual(classify({ 'cli.log': '' }, 142), { st: 'TIMEOUT', stop: null });
});
