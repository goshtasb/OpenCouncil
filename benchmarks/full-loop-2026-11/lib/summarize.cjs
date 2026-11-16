#!/usr/bin/env node
'use strict';
// Builds summary.md from the results folder.  node summarize.cjs <results dir> <benchmark dir>
const fs = require('fs');
const path = require('path');
const [res, bench] = process.argv.slice(2);
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const text = (f, d = '') => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return d; } };
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mins = s => (s == null ? '-' : `${(s / 60).toFixed(1)} min`);

const runs = [];
for (const task of fs.existsSync(res) ? fs.readdirSync(res).sort() : []) {
  const td = path.join(res, task);
  if (!fs.statSync(td).isDirectory()) continue;
  for (const r of fs.readdirSync(td).sort()) {
    const m = /^(mixed|solo|single)-(\d+)$/.exec(r);
    if (!m) continue;
    const dir = path.join(td, r);
    const score = read(path.join(dir, 'score.json'), { status: 'MISSING' });
    const tests = read(path.join(dir, 'tests.json'), null);
    const outcome = text(path.join(dir, 'outcome')).split('\n').filter(Boolean);
    const calls = text(path.join(dir, 'calls.jsonl')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
    runs.push({
      task, arm: m[1], n: +m[2], dir, status: score.status, detail: score.detail || '', passed: !!score.passed,
      seconds: +text(path.join(dir, 'seconds'), '0') || null, tests, outcome,
      flip: read(path.join(dir, 'flip.json'), null),
      cost: calls.reduce((s, c) => s + (typeof c.cost_usd === 'number' ? c.cost_usd : 0), 0),
      gemini: calls.filter(c => c.vendor === 'gemini').length, grok: calls.filter(c => c.vendor === 'grok').length,
      // The Lead PM model this run actually called, else the one it was set up with.
      lead: m[1] === 'mixed' ? ((calls.find(c => c.vendor === 'gemini' && c.model) || {}).model || text(path.join(dir, 'lead-model')) || null) : null
    });
  }
}
const arms = ['mixed', 'solo', 'single'].filter(a => runs.some(r => r.arm === a));
const tasks = [...new Set(runs.map(r => r.task))];
const scored = runs.filter(r => r.status === 'OK');
const L = [];
L.push('# Full loop: council vs one agent, results', '', '```', text(path.join(res, 'meta.txt')), '```', '');
const devs = text(path.join(res, 'deviations.txt')).split('\n').filter(Boolean);
if (devs.length) L.push('## Deviations from the pre-registration', '', ...devs.map(d => `- ${d}`), '');
const unscored = {};
for (const r of runs) if (r.status !== 'OK') unscored[r.status] = (unscored[r.status] || 0) + 1;
const why = Object.entries(unscored).map(([k, v]) => `${v} ${k}`).join(', ');
L.push(`${scored.length} scored runs, ${runs.length - scored.length} not scored${why ? ` (${why})` : ''}. Runs stopped by an error, a timeout, a usage limit, a sign-in prompt or a seat failure are re-run, never counted as misses.`, '');

L.push('## Passed every hidden test (primary metric)', '', `| Task | ${arms.join(' | ')} |`, `| --- |${arms.map(() => ' --- |').join('')}`);
const cell = rs => (rs.length ? `${rs.filter(r => r.passed).length}/${rs.length}` : '-');
for (const t of tasks) L.push(`| ${t} | ${arms.map(a => cell(scored.filter(r => r.task === t && r.arm === a))).join(' | ')} |`);
L.push(`| **All tasks** | ${arms.map(a => `**${cell(scored.filter(r => r.arm === a))}**`).join(' | ')} |`, '');

const leads = [...new Set(scored.filter(r => r.arm === 'mixed' && r.lead).map(r => r.lead))];
const prereg = (/^pre-registered lead \(mixed\): (\S+)/m.exec(text(path.join(res, 'meta.txt'))) || [])[1];
if (leads.some(l => l !== prereg)) {
  L.push('## Mixed arm by Lead PM model', '', 'The Lead PM model was not the pre-registered one for some or all mixed runs (see Deviations). Each line sets that model\'s mixed runs against the single agent\'s runs on the same tasks only.', '');
  for (const lm of [...leads].sort((a, b) => (b === prereg) - (a === prereg))) {
    const mr = scored.filter(r => r.arm === 'mixed' && r.lead === lm);
    const ts = new Set(mr.map(r => r.task));
    const sr = scored.filter(r => r.arm === 'single' && ts.has(r.task));
    L.push(`- **Lead PM ${lm}${lm === prereg ? ' (pre-registered)' : ''}**: mixed ${cell(mr)} passed vs single ${cell(sr)} on the same ${ts.size} task${ts.size === 1 ? '' : 's'}`);
  }
  L.push('');
}

L.push('## Each hidden test (secondary: share of runs that passed it)', '');
for (const t of tasks) {
  const names = [...new Set(scored.filter(r => r.task === t && r.tests).flatMap(r => r.tests.hiddenTests.map(x => x.name)))];
  if (!names.length) continue;
  L.push(`**${t}**`, '', `| Hidden test | ${arms.join(' | ')} |`, `| --- |${arms.map(() => ' --- |').join('')}`);
  for (const n of names) {
    L.push(`| ${n.replace(/^hidden: /, '')} | ${arms.map(a => {
      const rs = scored.filter(r => r.task === t && r.arm === a && r.tests);
      return rs.length ? `${rs.filter(r => (r.tests.hiddenTests.find(x => x.name === n) || {}).ok).length}/${rs.length}` : '-';
    }).join(' | ')} |`);
  }
  L.push('');
}

const council = scored.filter(r => r.arm !== 'single');
if (council.length) {
  L.push('## How council runs ended', '', '| Arm | Stalled in planning | Blocked in execution | Done | Done but failed hidden tests (false done) |', '| --- | --- | --- | --- | --- |');
  for (const a of arms.filter(x => x !== 'single')) {
    const rs = council.filter(r => r.arm === a);
    const stalled = rs.filter(r => r.outcome[0] && !/AWAITING_APPROVAL/.test(r.outcome[0])).length;
    const blocked = rs.filter(r => /execution: BLOCKED/.test(r.outcome.join(' '))).length;
    const done = rs.filter(r => /execution: DONE/.test(r.outcome.join(' ')));
    L.push(`| ${a} | ${stalled} | ${blocked} | ${done.length} | ${done.filter(r => !r.passed).length} |`);
  }
  L.push('', 'A stalled or blocked run is scored on whatever its working tree holds (usually the untouched repo), so it counts as a miss.', '');
  L.push('## Late sign-off concerns that would have flipped the gate', '');
  L.push('For council runs that failed a hidden test: did a concern raised at sign-off (Chief Architect review or Lead sign-off, after the Engineer ratified) name that problem? Judged by Claude Opus from the sign-off text and the hidden test source.', '');
  L.push('"Named in the final plan" counts failures the council\'s own final plan described (and then deferred, ruled out of scope or got wrong), as opposed to never seeing them.', '');
  L.push('| Arm | Failed hidden tests | Named in a late sign-off | Runs where a late sign-off named a failure | Named in the final plan |', '| --- | --- | --- | --- | --- |');
  for (const a of arms.filter(x => x !== 'single')) {
    const rs = council.filter(r => r.arm === a && r.flip);
    const failed = rs.reduce((s, r) => s + (r.flip.failingHidden || 0), 0);
    const named = rs.reduce((s, r) => s + (r.flip.wouldFlip || 0), 0);
    const inPlan = rs.reduce((s, r) => s + (r.flip.inPlan || 0), 0);
    L.push(`| ${a} | ${failed} | ${named} | ${rs.filter(r => r.flip.wouldFlip > 0).length}/${rs.filter(r => r.flip.failingHidden > 0).length} | ${inPlan} |`);
  }
  L.push('');
}

L.push('## Time and cost', '', '| Arm | Runs | Median time | Claude cost per run (API price) | Gemini calls per run | Grok calls per run |', '| --- | --- | --- | --- | --- | --- |');
for (const a of arms) {
  const rs = scored.filter(r => r.arm === a);
  if (!rs.length) continue;
  const avg = f => (rs.reduce((s, r) => s + f(r), 0) / rs.length);
  L.push(`| ${a} | ${rs.length} | ${mins(median(rs.map(r => r.seconds).filter(Boolean)))} | $${avg(r => r.cost).toFixed(2)} | ${avg(r => r.gemini).toFixed(1)} | ${avg(r => r.grok).toFixed(1)} |`);
}
L.push('', 'Claude cost is the API-price figure Claude Code reports for each call; on a plan nothing is billed per call.', '');

L.push('## Every run', '');
for (const r of runs) {
  const failed = r.tests ? r.tests.hiddenTests.filter(x => !x.ok).map(x => x.name.replace(/^hidden: /, '')) : [];
  const what = r.status !== 'OK' ? `NOT SCORED (${r.status}: ${r.detail})` : r.passed ? 'PASS' : `FAIL: ${failed.join('; ') || (r.tests && !r.tests.visiblePassed ? 'original tests failing' : '?')}`;
  L.push(`- **${r.task} ${r.arm} ${r.n}: ${what}** (${mins(r.seconds)}${r.lead ? `, Lead PM ${r.lead}` : ''}${r.outcome.length ? ', ' + r.outcome.join(', ') : ''})`);
  if (r.flip && r.flip.items) for (const i of r.flip.items) {
    if (i.named) L.push(`  > late sign-off (${i.stage}) named "${i.test.replace(/^hidden: /, '')}": ${i.quote}`);
    if (i.inPlan) L.push(`  > final plan named "${i.test.replace(/^hidden: /, '')}": ${i.planQuote}`);
  }
}
process.stdout.write(L.join('\n') + '\n');
