#!/usr/bin/env node
'use strict';
// Builds summary.md from the results folder.  node summarize.cjs <results dir>
const fs = require('fs');
const path = require('path');
const [res] = process.argv.slice(2);
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const text = (f, d = '') => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return d; } };
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mins = s => (s == null ? '-' : `${(s / 60).toFixed(1)} min`);

// One-sided Fisher's exact test on the pooled counts: build passes more often than single.
function fisherGreater(a, n1, c, n2) {
  const lf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const K = a + c, N = n1 + n2;
  const p = x => Math.exp(lf(K) + lf(N - K) + lf(n1) + lf(n2) - lf(x) - lf(K - x) - lf(n1 - x) - lf(n2 - K + x) - lf(N));
  let sum = 0;
  for (let x = a; x <= Math.min(K, n1); x++) if (n2 - K + x >= 0) sum += p(x);
  return Math.min(1, sum);
}

const runs = [];
for (const task of fs.existsSync(res) ? fs.readdirSync(res).sort() : []) {
  const td = path.join(res, task);
  if (!fs.statSync(td).isDirectory()) continue;
  for (const name of fs.readdirSync(td).sort()) {
    const m = /^(build|single)-(\d+)$/.exec(name);
    if (!m) continue;
    const dir = path.join(td, name);
    const score = read(path.join(dir, 'score.json'), { status: 'MISSING' });
    const calls = text(path.join(dir, 'calls.jsonl')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
    const status = read(path.join(dir, 'session', 'STATUS.json'), null);
    runs.push({
      task, arm: m[1], n: +m[2], status: score.status, kind: score.kind || '', detail: score.detail || '', passed: !!score.passed,
      seconds: +text(path.join(dir, 'seconds'), '0') || null, tests: read(path.join(dir, 'tests.json'), null),
      outcome: text(path.join(dir, 'outcome')), build: status ? status.details || {} : null, buildStatus: status ? status.status : null,
      risks: read(path.join(dir, 'session', 'risks.json'), []),
      cost: calls.reduce((s, c) => s + (typeof c.cost_usd === 'number' ? c.cost_usd : 0), 0),
      gemini: calls.filter(c => c.vendor === 'gemini').length, grok: calls.filter(c => c.vendor === 'grok').length
    });
  }
}
const arms = ['build', 'single'].filter(a => runs.some(r => r.arm === a));
const tasks = [...new Set(runs.map(r => r.task))];
// Primary: every run that reached an end of its own, plus every crash or timeout as a miss. Usage limits,
// sign-in prompts and harness errors are left out and re-run.
const counted = runs.filter(r => r.status === 'OK' || r.status === 'CRASH');
const scored = runs.filter(r => r.status === 'OK');
const crashes = counted.filter(r => r.status === 'CRASH');
const cell = rs => (rs.length ? `${rs.filter(r => r.passed).length}/${rs.length}` : '-');
const table = (rows, title) => {
  const out = [title, '', `| Task | ${arms.join(' | ')} |`, `| --- |${arms.map(() => ' --- |').join('')}`];
  for (const t of tasks) out.push(`| ${t} | ${arms.map(a => cell(rows.filter(r => r.task === t && r.arm === a))).join(' | ')} |`);
  out.push(`| **All tasks** | ${arms.map(a => `**${cell(rows.filter(r => r.arm === a))}**`).join(' | ')} |`, '');
  return out;
};

const L = [];
L.push('# council build vs one agent: results', '', '```', text(path.join(res, 'meta.txt')), '```', '');
const devs = text(path.join(res, 'deviations.txt')).split('\n').filter(Boolean);
if (devs.length) L.push('## Deviations from the pre-registration', '', ...devs.map(d => `- ${d}`), '');
const left = {};
for (const r of runs) if (!counted.includes(r)) left[r.status] = (left[r.status] || 0) + 1;
L.push(`${counted.length} runs counted (${crashes.length} crashed or timed out and count as misses), ${runs.length - counted.length} not counted${Object.keys(left).length ? ` (${Object.entries(left).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}.`, '');

L.push(...table(counted, '## Passed every hidden test (primary: crashes and timeouts count as misses)'));
const b = counted.filter(r => r.arm === 'build'), s = counted.filter(r => r.arm === 'single');
if (b.length && s.length) {
  const p = fisherGreater(b.filter(r => r.passed).length, b.length, s.filter(r => r.passed).length, s.length);
  const rate = rs => (100 * rs.filter(r => r.passed).length / rs.length).toFixed(0);
  L.push(`build ${rate(b)}% vs single ${rate(s)}%. One-sided Fisher's exact test, build > single: p = ${p.toFixed(3)}${p < 0.05 ? ' (significant at 0.05)' : ' (not significant at 0.05)'}. With this many runs only a large difference can show.`, '');
}
if (crashes.length) L.push(...table(scored, '## Same table without the crashes and timeouts (secondary)'));

L.push('## Each hidden test (share of scored runs that passed it)', '');
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

if (b.length) {
  const done = b.filter(r => r.buildStatus === 'DONE' && r.status === 'OK');
  L.push('## How build runs ended', '', '| Done | Blocked | Crashed or timed out | Done but failed a hidden test (false done) |', '| --- | --- | --- | --- |');
  L.push(`| ${done.length} | ${b.filter(r => r.buildStatus === 'BLOCKED' && r.status === 'OK').length} | ${b.filter(r => r.status === 'CRASH').length} | ${done.filter(r => !r.passed).length} |`, '');
  L.push('A blocked run is scored on what its checkout holds; a crash or timeout is a miss.', '');
  const wl = b.filter(r => r.build);
  const sum = f => wl.reduce((acc, r) => acc + (+f(r) || 0), 0);
  const byVendor = {};
  for (const r of wl) for (const k of r.risks || []) byVendor[k.vendor] = (byVendor[k.vendor] || 0) + 1;
  const gaps = wl.flatMap(r => r.build.gaps || []);
  L.push('## The risk ledger', '');
  L.push(`Over ${wl.length} build runs: ${sum(r => r.build.risks)} risks named (${Object.entries(byVendor).map(([v, c]) => `${v} ${c}`).join(', ') || 'none'}), ${sum(r => r.build.tested)} ended as passing tests, ${sum(r => r.build.rejected)} rejected with a quote, ${sum(r => r.build.missing)} left missing. ${gaps.length} seat gap${gaps.length === 1 ? '' : 's'}.`, '');
  L.push('| Step | Median time |', '| --- | --- |');
  for (const [k, label] of [['buildSeconds', 'build'], ['risks1Seconds', 'risk round'], ['tests1Seconds', 'risk tests']]) {
    L.push(`| ${label} | ${mins(median(wl.map(r => (r.build.timings || {})[k]).filter(x => typeof x === 'number')))} |`);
  }
  L.push('');
}

L.push('## Time and cost', '', '| Arm | Runs | Median time | Claude cost per run (API price) | Gemini calls per run | Grok calls per run |', '| --- | --- | --- | --- | --- | --- |');
for (const a of arms) {
  const rs = counted.filter(r => r.arm === a);
  if (!rs.length) continue;
  const avg = f => (rs.reduce((acc, r) => acc + f(r), 0) / rs.length);
  L.push(`| ${a} | ${rs.length} | ${mins(median(rs.map(r => r.seconds).filter(Boolean)))} | $${avg(r => r.cost).toFixed(2)} | ${avg(r => r.gemini).toFixed(1)} | ${avg(r => r.grok).toFixed(1)} |`);
}
L.push('', 'Claude cost is the API-price figure Claude Code reports for each call; on a plan nothing is billed per call.', '');

L.push('## Every run', '');
for (const r of runs) {
  const failed = r.tests ? r.tests.hiddenTests.filter(x => !x.ok).map(x => x.name.replace(/^hidden: /, '')) : [];
  const what = r.status === 'CRASH' ? `MISS (${r.kind}: ${r.detail})` : r.status !== 'OK' ? `NOT COUNTED (${r.status}: ${r.detail})` : r.passed ? 'PASS' : `FAIL: ${failed.join('; ') || (r.tests && !r.tests.visiblePassed ? 'original tests failing' : '?')}`;
  const ledger = r.build && typeof r.build.risks === 'number' ? `, ${r.build.risks} risks: ${r.build.tested || 0} tested, ${r.build.rejected || 0} rejected, ${r.build.missing || 0} missing` : '';
  L.push(`- **${r.task} ${r.arm} ${r.n}: ${what}** (${mins(r.seconds)}${r.outcome ? ', ' + r.outcome : ''}${ledger})`);
  if (failed.length) for (const k of r.risks || []) L.push(`  > ${k.id} ${k.vendor}: ${String(k.title).slice(0, 160)}`);
}
process.stdout.write(L.join('\n') + '\n');
