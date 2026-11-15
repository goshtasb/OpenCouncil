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
