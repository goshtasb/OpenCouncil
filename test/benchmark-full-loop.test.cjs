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

test('preflight: out of quota, the Lead PM swaps to the next candidate, logged as a deviation', { skip: !hasPerl && 'needs perl' }, () => {
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

test('preflight: a Claude usage limit says so plainly and runs nothing', { skip: !hasPerl && 'needs perl' }, () => {
  const dir = tmp('fl-pre-');
  const r = run(dir, stubs(dir, { claudeLimit: true }), { ARMS: 'single' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Your Claude plan's usage limit is reached .*Nothing has run\. Paste the same command again after it resets/);
});

test('only one batch runs at a time', { skip: !hasPerl && 'needs perl' }, () => {
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

test('a Claude usage limit mid-batch stops it, is not scored as a miss, and the same command resumes', { skip: !hasPerl && 'needs perl' }, () => {
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
