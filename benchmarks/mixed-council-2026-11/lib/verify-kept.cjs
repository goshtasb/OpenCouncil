#!/usr/bin/env node
'use strict';
// One-time check of runs judged before the checkout fix (2026-11-15), run by run.sh before a resumed batch.
//   node verify-kept.cjs <results dir> <tasks.json> <fixture.sh> <cache dir> <judges>
// Before the fix, parallel runs could clone a task's template while another run was rebuilding it. Two
// ways that could have given a run the wrong checkout:
//   1. The clone caught the template between its base commit and its PR commit: the run reviewed an
//      empty or partial change. Caught here by checking that the diff the run was given (the single
//      agent's prompt.md, the council's session/task.md) contains the PR's exact diff.
//   2. The clone caught a rebuild that committed a damaged base plus the full PR change, just before
//      that rebuild failed its own tree check. Every such rebuild ends its make.log with "tree
//      mismatch", so if any make.log in the batch says so, the kept runs of that task are set aside.
// A run that fails either check, or can't be checked, is moved to <results>/set-aside/ and is re-run.
// The report goes to <results>/kept-check.txt; once that file exists this does nothing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const [res, tasksFile, fixture, cache, judges] = process.argv.slice(2);
const report = path.join(res, 'kept-check.txt');
if (fs.existsSync(report)) process.exit(0);

const judged = dir => judges.split(/\s+/).filter(Boolean).every(j => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, `judge-${j}.json`), 'utf8')).status === 'OK'; } catch { return false; }
});
const runs = [];
const mismatchTasks = new Set();
for (const task of fs.existsSync(res) ? fs.readdirSync(res).sort() : []) {
  const td = path.join(res, task);
  if (task === 'set-aside' || !fs.statSync(td).isDirectory()) continue;
  for (const r of fs.readdirSync(td).sort()) {
    const m = /^(mixed|solo|single)-(\d+)$/.exec(r);
    if (!m) continue;
    const dir = path.join(td, r);
    const log = path.join(dir, 'make.log');
    if (fs.existsSync(log) && /tree mismatch/.test(fs.readFileSync(log, 'utf8'))) mismatchTasks.add(task);
    if (judged(dir)) runs.push({ task, arm: m[1], n: m[2], dir });
  }
}

const expected = {};
const lines = [`Check of runs judged before the checkout fix, ${new Date().toISOString()}`, ''];
const setAside = (r, why) => {
  const dest = path.join(res, 'set-aside', `${r.task}-${r.arm}-${r.n}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(r.dir, dest);
  lines.push(`SET ASIDE ${r.task} ${r.arm} ${r.n}: ${why} (moved to set-aside/, will be re-run)`);
};
let kept = 0;
for (const r of runs) {
  if (mismatchTasks.has(r.task)) { setAside(r, 'a cache rebuild for this task failed its tree check, so its checkout can\'t be vouched for'); continue; }
  if (!(r.task in expected)) {
    const w = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-'));
    try {
      execFileSync('bash', [fixture, tasksFile, r.task, cache, path.join(w, 'app')], { stdio: ['ignore', 'ignore', 'pipe'] });
      expected[r.task] = execFileSync('git', ['diff', '--no-color', 'main...HEAD'], { cwd: path.join(w, 'app'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trimEnd();
    } catch (e) {
      expected[r.task] = null;
      lines.push(`could not build a checkout of ${r.task} to compare against: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    } finally { fs.rmSync(w, { recursive: true, force: true }); }
  }
  const want = expected[r.task];
  if (want == null) { setAside(r, 'no checkout to compare against'); continue; }
  const src = path.join(r.dir, r.arm === 'single' ? 'prompt.md' : path.join('session', 'task.md'));
  if (!fs.existsSync(src)) { setAside(r, `${path.relative(r.dir, src)} is missing, so the diff it reviewed can't be checked`); continue; }
  if (!fs.readFileSync(src, 'utf8').includes(want)) { setAside(r, 'the diff it reviewed is not the PR\'s diff'); continue; }
  lines.push(`kept ${r.task} ${r.arm} ${r.n}: reviewed the PR's exact diff`);
  kept++;
}
lines.splice(2, 0, `${kept} of ${runs.length} judged runs kept; ${runs.length - kept} set aside to re-run. Make logs with a failed tree check: ${mismatchTasks.size ? [...mismatchTasks].join(', ') : 'none'}.`, '');
fs.writeFileSync(report, lines.join('\n') + '\n');
console.log(lines[2]);
