// The full-loop benchmark's harness (benchmarks/full-loop-2026-11): usage-limit and sign-in detection, the
// Lead PM fallback, one batch at a time, and a usage limit that stops the batch without counting as a miss.
// Runs with stub CLIs; no model is called and nothing leaves the machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BENCH = path.join(__dirname, '..', 'benchmarks', 'full-loop-2026-11');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const hasPerl = spawnSync('perl', ['-v']).status === 0;
// run.sh itself requires Node 20 or newer.
const canRun = !hasPerl ? 'needs perl' : +process.versions.node.split('.')[0] < 20 ? 'run.sh needs Node 20' : false;
const LIMIT_TEXT = "You've hit your weekly limit · resets Nov 21, 5pm";

// ------------------------------------------------------------------ limits.cjs
function limits(files, mode) {
  const d = tmp('fl-lim-');
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body);
  return execFileSync('node', [path.join(BENCH, 'lib', 'limits.cjs'), d, mode]).toString().trim();
}
const claudeCall = (o) => JSON.stringify({ vendor: 'claude', alias: 'opus', seconds: 1, code: 0, ...o }) + '\n';

test('limits: a Claude error result that names a limit is a Claude limit', () => {
  assert.match(limits({ 'calls.jsonl': claudeCall({ code: 1, is_error: true, error: LIMIT_TEXT }) }, 'run'), /^limit claude: You've hit your weekly limit/);
  assert.match(limits({ 'calls.jsonl': claudeCall({ code: 1, parse_error: true, error: 'Claude AI usage limit reached|1731' }) }, 'single'), /^limit claude/);
});

test('limits: model text about quotas and rate limits is never read as a limit', () => {
  // The council's own log and a normal Claude answer can talk about quotas: the daily-usage task is about them.
  assert.equal(limits({
    'cli.log': 'Lead PM: enforce the daily quota; return 429 Too Many Requests when the rate limit is exceeded.\n',
    'calls.jsonl': claudeCall({ is_error: false }),
    'claude-stderr.log': ''
  }, 'run'), '');
});

test('limits: each CLI is named from its own stderr; an Antigravity sign-in prompt wins', () => {
  assert.match(limits({ 'agy-stderr.log': 'error: Individual quota reached. Resets in 151h\n' }, 'run'), /^limit gemini: error: Individual quota reached/);
  assert.match(limits({ 'grok-stderr.log': 'Error 429: rate limit\n', 'claude-stderr.log': LIMIT_TEXT }, 'run'), /^limit claude grok/);
  assert.equal(limits({ 'agy-stderr.log': 'Paste this code into your application to complete authentication:\n', 'grok-stderr.log': 'quota' }, 'run'), 'signin');
  // A single-agent run's cli.log is Claude Code's stderr.
  assert.match(limits({ 'cli.log': LIMIT_TEXT }, 'single'), /^limit claude/);
  // The judge reads its own files only.
  assert.equal(limits({ 'calls.jsonl': claudeCall({ is_error: true, error: LIMIT_TEXT }) }, 'judge'), '');
  assert.match(limits({ 'judge-calls.jsonl': claudeCall({ is_error: true, error: LIMIT_TEXT }) }, 'judge'), /^limit claude/);
});

// ------------------------------------------------------------------ run.sh with stub CLIs
function stubs(dir, { down = [], claudeLimit = false } = {}) {
  const bin = path.join(dir, 'fake');
  fs.mkdirSync(bin);
  const w = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  w('agy', `[ "$1" = --version ] && { echo "agy 0"; exit 0; }
[ "$1" = models ] && { printf 'Available models:\\n  gemini-4-argon-high (default)\\n  gemini-3.8-flash-high\\n  gemini-3.1-pro-high\\n'; exit 0; }
m=""; prev=""; for a in "$@"; do [ "$prev" = --model ] && m=$a; prev=$a; done
case " ${down.join(' ')} " in *" $m "*) echo "Individual quota reached for $m. Resets in 151h" >&2; exit 1;; esac
echo ok`);
  // Claude answers the preflight ping; the work call hits the limit while <dir>/limit exists.
  const limitJson = path.join(dir, 'limit.json');
  fs.writeFileSync(limitJson, JSON.stringify({ type: 'result', is_error: true, result: LIMIT_TEXT }));
  w('claude', `[ "$1" = --version ] && { echo "0 (Claude Code)"; exit 0; }
case "$*" in *"Reply with the single word ok."*) ;; *)
  if [ -f "${path.join(dir, 'limit')}" ]; then cat "${limitJson}"; exit 1; fi;;
esac
${claudeLimit ? `cat "${limitJson}"; exit 1` : `echo '{"type":"result","is_error":false,"result":"ok","modelUsage":{"claude-opus":{}}}'`}`);
  w('grok', `[ "$1" = --version ] && { echo "grok 0"; exit 0; }
[ "$1" = models ] && { echo grok-4.7; exit 0; }
echo ok`);
  const tool = path.join(dir, 'root', 'tool', 'node_modules', 'open-council-cli');
  fs.mkdirSync(path.join(tool, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tool, 'package.json'), JSON.stringify({ name: 'open-council-cli', version: '0.4.0' }));
  fs.writeFileSync(path.join(tool, 'bin', 'council.js'), 'console.log("all seats answer");\n');
  return bin;
}
function run(dir, bin, env) {
  const r = spawnSync('bash', [path.join(BENCH, 'run.sh')], {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, BENCH_ROOT: path.join(dir, 'root'), GROK_BIN: path.join(bin, 'grok'), ...env },
    encoding: 'utf8', timeout: 300000
  });
  const read = f => { try { return fs.readFileSync(path.join(dir, 'root', f), 'utf8'); } catch { return ''; } };
  return { code: r.status, out: r.stdout + r.stderr, read };
}

test('preflight: out of quota, the Lead PM swaps to the next candidate, logged as a deviation', { skip: canRun }, () => {
  const dir = tmp('fl-pre-');
  const bin = stubs(dir, { down: ['gemini-4-argon-high'] });
  const r = run(dir, bin, { PREFLIGHT_ONLY: '1', LEAD_CANDIDATES: 'gemini-4-argon-high gemini-3.8-flash-high auto' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.read('results/meta.txt'), /^lead \(mixed\): gemini-3\.8-flash-high$/m);
  assert.match(r.read('results/meta.txt'), /^pre-registered lead \(mixed\): gemini-4-argon-high$/m);
  assert.match(r.read('results/deviations.txt'), /Lead PM \(mixed arm\) is gemini-3\.8-flash-high .*Individual quota reached/);
  // With no candidates it tries only the pre-registered model and stops, as before.
  const dir2 = tmp('fl-pre-');
  const r2 = run(dir2, stubs(dir2, { down: ['gemini-4-argon-high'] }), { PREFLIGHT_ONLY: '1' });
  assert.notEqual(r2.code, 0);
  assert.match(r2.out, /No Lead PM model answered; gemini-4-argon-high/);
});

test('preflight: a Claude usage limit says so plainly and runs nothing', { skip: canRun }, () => {
  const dir = tmp('fl-pre-');
  const r = run(dir, stubs(dir, { claudeLimit: true }), { ARMS: 'single' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Your Claude plan's usage limit is reached .*Nothing has run\. Paste the same command again after it resets/);
});

test('only one batch runs at a time', { skip: canRun }, () => {
  const dir = tmp('fl-lock-');
  const bin = stubs(dir);
  fs.mkdirSync(path.join(dir, 'root', '.running'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'root', '.running', 'pid'), String(process.pid));
  const r = run(dir, bin, { PREFLIGHT_ONLY: '1', ARMS: 'single' });
  assert.equal(r.code, 1);
  assert.match(r.out, /already running in another window/);
  // A lock left by a batch that died is taken over.
  fs.writeFileSync(path.join(dir, 'root', '.running', 'pid'), '999999');
  const r2 = run(dir, bin, { PREFLIGHT_ONLY: '1', ARMS: 'single' });
  assert.equal(r2.code, 0, r2.out);
  assert.equal(fs.existsSync(path.join(dir, 'root', '.running')), false, 'the lock is released on exit');
});

test('a Claude usage limit mid-batch stops it, is not scored as a miss, and the same command resumes', { skip: canRun }, () => {
  const dir = tmp('fl-run-');
  const bin = stubs(dir);
  const env = { ARMS: 'single', TASKS: 'late-fees', RUNS_SINGLE: '2', PARALLEL: '1' };
  fs.writeFileSync(path.join(dir, 'limit'), '');
  const r = run(dir, bin, env);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /late-fees single 1: LIMIT, not scored \(limit claude: You've hit your weekly limit/);
  assert.match(r.out, /Your Claude plan's usage limit was reached, so the batch stopped early .*\n.*never count as misses\. Paste the same command after the limit resets/);
  assert.match(r.read('results/late-fees/single-1/score.json'), /"status":"LIMIT"/);
  assert.equal(fs.existsSync(path.join(dir, 'root', 'results', 'late-fees', 'single-2')), false, 'nothing starts after the stop');
  assert.match(r.read('summary.md'), /0 scored runs, 1 not scored \(1 LIMIT\)/);
  // The limit resets: the same command re-runs the stopped run and finishes the batch.
  fs.rmSync(path.join(dir, 'limit'));
  const r2 = run(dir, bin, env);
  assert.equal(r2.code, 0, r2.out);
  assert.match(r2.out, /2 runs to do/);
  for (const n of [1, 2]) assert.match(r2.read(`results/late-fees/single-${n}/score.json`), /"status": "OK"/);
  assert.match(r2.read('summary.md'), /2 scored runs, 0 not scored\./);
  assert.doesNotMatch(r2.out, /usage limit was reached/);
});

// ------------------------------------------------------------------ summarize.cjs
test('summarize: a Lead PM swap is listed and each model is compared on its own tasks', () => {
  const res = tmp('fl-sum-');
  fs.writeFileSync(path.join(res, 'meta.txt'), 'lead (mixed): gemini-3.8-flash-high\npre-registered lead (mixed): gemini-4-argon-high\n');
  fs.writeFileSync(path.join(res, 'deviations.txt'), '2026-11-16 10:00 PST: Lead PM (mixed arm) is gemini-3.8-flash-high for runs from now on.\n');
  const put = (task, r, score, lead) => {
    const d = path.join(res, task, r); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'score.json'), JSON.stringify(score));
    fs.writeFileSync(path.join(d, 'seconds'), '60');
    if (lead) fs.writeFileSync(path.join(d, 'lead-model'), lead);
  };
  put('late-fees', 'mixed-1', { status: 'OK', passed: true }, 'gemini-3.8-flash-high');
  put('late-fees', 'mixed-2', { status: 'LIMIT', detail: 'limit claude' }, 'gemini-3.8-flash-high');
  put('late-fees', 'single-1', { status: 'OK', passed: false });
  put('daily-usage', 'single-1', { status: 'OK', passed: true });
  const md = execFileSync('node', [path.join(BENCH, 'lib', 'summarize.cjs'), res, BENCH]).toString();
  assert.match(md, /## Deviations from the pre-registration\n\n- 2026-11-16 10:00 PST: Lead PM/);
  assert.match(md, /3 scored runs, 1 not scored \(1 LIMIT\)/);
  assert.match(md, /\*\*Lead PM gemini-3\.8-flash-high\*\*: mixed 1\/1 passed vs single 0\/1 on the same 1 task\b/);
  assert.match(md, /late-fees mixed 1: PASS\*\* \(1\.0 min, Lead PM gemini-3\.8-flash-high\)/);
});

test('summarize: council crashes and timeouts are counted as misses in a second table, limits and sign-ins are not', () => {
  const res = tmp('fl-sum-');
  const put = (task, r, score) => {
    const d = path.join(res, task, r); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'score.json'), JSON.stringify(score));
  };
  put('late-fees', 'mixed-1', { status: 'COUNCIL-ERROR', detail: 'exit 3' });
  put('late-fees', 'mixed-2', { status: 'TIMEOUT', detail: 'exit 142' });
  put('late-fees', 'mixed-3', { status: 'SIGNIN', detail: 'signin' });
  put('late-fees', 'single-1', { status: 'OK', passed: true });
  put('late-fees', 'single-2', { status: 'LIMIT', detail: 'limit claude' });
  put('daily-usage', 'mixed-1', { status: 'OK', passed: true });
  put('daily-usage', 'single-1', { status: 'OK', passed: true });
  const md = execFileSync('node', [path.join(BENCH, 'lib', 'summarize.cjs'), res, BENCH]).toString();
  const primary = md.split('## Passed every hidden test')[1].split('\n## ')[0];
  assert.match(primary, /\| late-fees \| - \| 1\/1 \|/, 'the primary table is unchanged');
  const second = md.split('## Counting crashes and timeouts as misses (not pre-registered)')[1].split('\n## ')[0];
  assert.match(second, /the 2 runs that ended on a council error/);
  assert.match(second, /\| late-fees \| 0\/2 \| 1\/1 \|/);
  assert.match(second, /\| \*\*All tasks\*\* \| \*\*1\/3\*\* \| \*\*2\/2\*\* \|/);
  // With no crash the extra table is left out.
  fs.rmSync(path.join(res, 'late-fees'), { recursive: true });
  assert.doesNotMatch(execFileSync('node', [path.join(BENCH, 'lib', 'summarize.cjs'), res, BENCH]).toString(), /Counting crashes/);
});

// ------------------------------------------------------------------ Antigravity sign-in prompts
test('an Antigravity sign-in prompt stops the batch at once, and later Lead PM calls are skipped, not sent', { skip: canRun }, () => {
  const dir = tmp('fl-signin-');
  const bin = stubs(dir);
  const r = run(dir, bin, { PREFLIGHT_ONLY: '1' });
  assert.equal(r.code, 0, r.out);
  // The real agy now wants a sign-in: it prints Google's page on stdout and waits for a code on stdin.
  const count = path.join(dir, 'agy-calls');
  fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/bash\necho x >> "${count}"\necho "Open https://accounts.google.com/o/oauth2/auth?client_id=1 and paste the code here:"\nread -r code || exit 1\n`);
  const out = path.join(dir, 'root', 'results', 'late-fees', 'mixed-1');
  fs.mkdirSync(out, { recursive: true });
  const stop = path.join(dir, 'root', 'results', 'STOP');
  const env = { ...process.env, BENCH_CALLS_LOG: path.join(out, 'calls.jsonl'), BENCH_STOP_FILE: stop };
  const shim = path.join(dir, 'root', 'bin', 'agy');
  const t0 = Date.now();
  const a = spawnSync(shim, ['-p', 'draft the plan', '--model', 'gemini-3.8-flash-high'], { env, encoding: 'utf8', timeout: 30000 });
  assert.ok(Date.now() - t0 < 10000, 'agy gets no stdin, so it cannot sit waiting for a code');
  assert.equal(a.status, 1);
  assert.match(a.stdout, /accounts\.google\.com/, 'the council still sees what agy printed');
  assert.equal(fs.readFileSync(stop, 'utf8'), 'signin\n');
  const b = spawnSync(shim, ['-p', 'round 2', '--model', 'gemini-3.8-flash-high'], { env, encoding: 'utf8' });
  assert.equal(b.status, 1);
  assert.match(b.stderr, /not signed in: call skipped/);
  assert.equal(fs.readFileSync(count, 'utf8'), 'x\n', 'the second call never reached agy, so no second sign-in page');
  // The run's own check after it ends sees the wrapper's line, not the model text.
  assert.equal(limits({ 'agy-stderr.log': fs.readFileSync(path.join(out, 'agy-stderr.log'), 'utf8') }, 'run'), 'signin');
});

test('a Lead PM answer that talks about signing in does not stop the batch', { skip: canRun }, () => {
  const dir = tmp('fl-signin-');
  const bin = stubs(dir);
  assert.equal(run(dir, bin, { PREFLIGHT_ONLY: '1' }).code, 0);
  const answer = 'Users must sign in again after 30 days; see accounts.google.com/o/oauth2 for SSO. Login required to redeem.';
  fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/bash\necho "${answer}"\n`);
  const out = path.join(dir, 'root', 'results', 'coupon-redeem', 'mixed-1');
  fs.mkdirSync(out, { recursive: true });
  const stop = path.join(dir, 'root', 'results', 'STOP');
  const env = { ...process.env, BENCH_CALLS_LOG: path.join(out, 'calls.jsonl'), BENCH_STOP_FILE: stop };
  const shim = path.join(dir, 'root', 'bin', 'agy');
  for (const round of [1, 2]) {
    const a = spawnSync(shim, ['-p', `round ${round}`, '--model', 'gemini-3.8-flash-high'], { env, encoding: 'utf8' });
    assert.equal(a.status, 0);
    assert.match(a.stdout, /sign in again/);
  }
  assert.equal(fs.existsSync(stop), false, 'no stop');
  assert.equal(limits({ 'agy-stdout.log': fs.readFileSync(path.join(out, 'agy-stdout.log'), 'utf8') }, 'run'), '', 'and the log of answers is never read as a sign-in');
});

test('preflight: a sign-in prompt stops it with what to do, without trying the other Lead PM models', { skip: canRun }, () => {
  const dir = tmp('fl-pre-');
  const bin = stubs(dir);
  const count = path.join(dir, 'agy-calls');
  fs.writeFileSync(path.join(bin, 'agy'), `#!/bin/bash\n[ "$1" = --version ] && { echo "agy 0"; exit 0; }\n[ "$1" = models ] && { printf 'gemini-4-argon-high\\ngemini-3.8-flash-high\\n'; exit 0; }\necho x >> "${count}"\necho "Please sign in again: https://accounts.google.com/o/oauth2/auth" >&2\nexit 1\n`);
  const r = run(dir, bin, { PREFLIGHT_ONLY: '1', LEAD_CANDIDATES: 'gemini-4-argon-high gemini-3.8-flash-high auto' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Antigravity wants you to sign in again\. Open a new Terminal window, run: agy/);
  assert.equal(fs.readFileSync(count, 'utf8'), 'x\n');
});

test('limits: model text that only mentions sign-in pages is not a sign-in prompt', () => {
  assert.equal(limits({ 'agy-stdout.log': 'Users who are not signed in see the public price; link to accounts.google.com/o/oauth for SSO.\n' }, 'run'), '');
});

test('a council that ends on an error is COUNCIL-ERROR, not scored as a miss', { skip: canRun }, () => {
  const dir = tmp('fl-err-');
  const bin = stubs(dir);
  // A council whose Lead PM seat fails: deliberate exits 1 and the session is left OPEN.
  fs.writeFileSync(path.join(dir, 'root', 'tool', 'node_modules', 'open-council-cli', 'bin', 'council.js'), `
const fs = require('fs'), path = require('path');
const [cmd] = process.argv.slice(2);
const s = path.join(process.env.COUNCIL_HOME, 'projects', 'p', 'sessions', 's1');
if (cmd === 'init') fs.mkdirSync('.council', { recursive: true });
else if (cmd === 'open') { fs.mkdirSync(s, { recursive: true }); fs.writeFileSync(path.join(s, 'STATUS.json'), JSON.stringify({ status: 'OPEN', details: {} })); console.log('s1'); }
else if (cmd === 'deliberate') { console.error('Lead PM seat failed: agy exited 1'); process.exit(1); }
`);
  const r = run(dir, bin, { ARMS: 'mixed', TASKS: 'late-fees', RUNS_COUNCIL: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /late-fees mixed 1: COUNCIL-ERROR \(exit 3\)/);
  assert.match(r.read('results/late-fees/mixed-1/score.json'), /"status":"COUNCIL-ERROR","detail":"exit 3: the council ended on an error \(deliberation: OPEN \)/);
  assert.match(r.read('summary.md'), /0 scored runs, 1 not scored \(1 COUNCIL-ERROR\)/);
});

test('a council run once scored as a miss after it ended on an error or a sign-in is set aside and re-run', { skip: canRun }, () => {
  const dir = tmp('fl-recheck-');
  const bin = stubs(dir);
  const res = path.join(dir, 'root', 'results');
  const put = (rel, outcome, extra = {}) => {
    const d = path.join(res, rel); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'score.json'), JSON.stringify({ status: 'OK', passed: false }, null, 2));
    fs.writeFileSync(path.join(d, 'flip.json'), JSON.stringify({ status: 'OK' }, null, 2));
    fs.writeFileSync(path.join(d, 'outcome'), outcome);
    for (const [f, b] of Object.entries(extra)) fs.writeFileSync(path.join(d, f), b);
  };
  put('late-fees/mixed-1', 'deliberation: STALLED\n');                                   // a real stall: kept
  put('late-fees/mixed-2', 'deliberation: AWAITING_APPROVAL\nexecution: BLOCKED\n');      // a real block: kept
  put('daily-usage/mixed-1', 'deliberation: OPEN\n');                                     // a seat error: set aside
  put('daily-usage/mixed-2', 'deliberation: STALLED\n', { 'agy-stderr.log': 'Paste this code into your application to complete authentication:\n' });
  const r = run(dir, bin, { ARMS: 'mixed', TASKS: 'late-fees', RUNS_COUNCIL: '2' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 runs to do/);
  const check = r.read('results/kept-check.txt');
  assert.match(check, /daily-usage\/mixed-1 set aside and re-run: the council ended on an error \(deliberation: OPEN \)/);
  assert.match(check, /daily-usage\/mixed-2 set aside and re-run: signin/);
  assert.doesNotMatch(check, /late-fees/);
  assert.ok(fs.readdirSync(path.join(res, 'daily-usage')).every(n => /\.setaside-/.test(n)));
  assert.ok(fs.existsSync(path.join(res, 'late-fees', 'mixed-1', 'score.json')));
});
