#!/usr/bin/env node
// Builds summary.md and summary.json from every judged run. Usage: node summarize.cjs <results dir> <bench dir>
// The metrics and tests are the ones pre-registered in README.md.
'use strict';
const fs = require('fs');
const path = require('path');

const [res, bench] = process.argv.slice(2);
const { tasks } = JSON.parse(fs.readFileSync(path.join(bench, 'tasks.json'), 'utf8'));
const ARMS = ['mixed', 'solo', 'single'];
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const json = f => { try { return JSON.parse(read(f)); } catch { return null; } };
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
const money = x => (x == null ? 'n/a' : `$${x.toFixed(2)}`);
const mins = s => (s == null ? 'n/a' : `${(s / 60).toFixed(1)} min`);

const runs = [];
const unscored = [];
for (const t of tasks) {
  const dir = path.join(res, t.id);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).sort()) {
    const m = /^(mixed|solo|single)-(\d+)$/.exec(name);
    if (!m) continue;
    const d = path.join(dir, name);
    const score = json(path.join(d, 'score.json'));
    if (!score || score.status !== 'OK') { unscored.push({ task: t.id, arm: m[1], n: +m[2], status: score ? score.status : 'NOT RUN', detail: score && score.detail }); continue; }
    const calls = read(path.join(d, 'calls.jsonl')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const claude = calls.filter(c => c.vendor === 'claude');
    const costs = claude.map(c => c.cost_usd).filter(x => typeof x === 'number');
    const sections = json(path.join(d, 'sections.json')) || [];
    runs.push({
      task: t.id, arm: m[1], n: +m[2], score, gemini: json(path.join(d, 'judge-gemini.json')), sections,
      seconds: Number(read(path.join(d, 'seconds')).trim()) || null,
      claude_cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      claude_models: [...new Set(claude.flatMap(c => c.models || []))],
      tokens: claude.reduce((a, c) => a + (c.input_tokens || 0) + (c.output_tokens || 0), 0),
      gemini_calls: calls.filter(c => c.vendor === 'gemini').length,
      grok_calls: calls.filter(c => c.vendor === 'grok').length,
      other_models: [...new Set(calls.filter(c => c.vendor !== 'claude').map(c => `${c.vendor}:${c.model || 'default'}`))]
    });
  }
}
const armsSeen = ARMS.filter(a => runs.some(r => r.arm === a));
const of = (arm, judge = 'claude') => runs.filter(r => r.arm === arm).map(r => (judge === 'claude' ? r.score : r.gemini)).filter(s => s && s.status === 'OK');

// Pooled recall over (run, known issue) pairs.
function pooled(arm, pick, judge = 'claude') {
  let f = 0, n = 0;
  for (const s of of(arm, judge)) for (const g of Object.values(s.found)) if (pick(g)) { n++; if (g.found) f++; }
  return { f, n };
}
const CORE = g => g.core;
const HC = g => g.core !== undefined && (g.severity === 'High' || g.severity === 'Critical');

// Per known issue: the share of an arm's runs that found it.
function rates(arm, judge = 'claude') {
  const out = {};
  for (const r of runs.filter(x => x.arm === arm)) {
    const s = judge === 'claude' ? r.score : r.gemini;
    if (!s || s.status !== 'OK') continue;
    for (const [id, g] of Object.entries(s.found)) {
      if (!g.core) continue;
      const k = `${r.task}/${id}`;
      out[k] = out[k] || { f: 0, n: 0 };
      out[k].n++; if (g.found) out[k].f++;
    }
  }
  return out;
}
// Two-sided exact sign test.
function signTest(wins, losses) {
  const n = wins + losses; if (!n) return 1;
  const lc = (a, b) => { let s = 0; for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i); return s; };
  const k = Math.min(wins, losses);
  let p = 0; for (let i = 0; i <= k; i++) p += Math.exp(lc(n, i) - n * Math.log(2));
  return Math.min(1, 2 * p);
}
function compare(x, y, judge = 'claude') {
  const rx = rates(x, judge), ry = rates(y, judge);
  let w = 0, l = 0, tie = 0;
  for (const k of Object.keys(rx)) {
    if (!ry[k]) continue;
    const d = rx[k].f / rx[k].n - ry[k].f / ry[k].n;
    if (d > 1e-9) w++; else if (d < -1e-9) l++; else tie++;
  }
  const a = pooled(x, CORE, judge), b = pooled(y, CORE, judge);
  return `${x} ${a.f}/${a.n} (${pct(a.f, a.n)}) vs ${y} ${b.f}/${b.n} (${pct(b.f, b.n)}). Known issues ${x} found more often: ${w}; ${y} more often: ${l}; same: ${tie}. Sign test two-sided p = ${signTest(w, l).toFixed(3)}`;
}

const L = [];
const meta = read(path.join(res, 'meta.txt'));
L.push('# Mixed council vs one agent on real pull requests: results', '');
if (meta) L.push('```', meta.trim(), '```', '');
L.push(`${runs.length} judged runs, ${unscored.length} not scored yet (errors, timeouts, usage limits or judge failures; the same command re-runs those, and they never count as misses).`, '');

L.push('## Known issues found (primary: core issues, Claude Opus judge)', '', `| Task | Core issues | ${armsSeen.map(a => `${a} (per run)`).join(' | ')} |`, `| --- | --- | ${armsSeen.map(() => '---').join(' | ')} |`);
for (const t of tasks) {
  const core = t.golden.filter(g => g.core).length;
  L.push(`| ${t.id} | ${core} | ${armsSeen.map(a => runs.filter(r => r.task === t.id && r.arm === a).sort((p, q) => p.n - q.n).map(r => r.score.core_found).join(', ') || '-').join(' | ')} |`);
}
L.push(`| **All** | | ${armsSeen.map(a => { const p = pooled(a, CORE); return `**${p.f}/${p.n} (${pct(p.f, p.n)})**`; }).join(' | ')} |`, '');
for (const [x, y] of [['mixed', 'single'], ['mixed', 'solo'], ['solo', 'single']]) if (armsSeen.includes(x) && armsSeen.includes(y)) L.push(`- ${compare(x, y)}`);
L.push('');

L.push('## Secondary measures', '', `| Measure | ${armsSeen.join(' | ')} |`, `| --- | ${armsSeen.map(() => '---').join(' | ')} |`);
const row = (name, f) => L.push(`| ${name} | ${armsSeen.map(f).join(' | ')} |`);
row('High or Critical issues found', a => { const p = pooled(a, HC); return `${p.f}/${p.n} (${pct(p.f, p.n)})`; });
row('Core issues raised as blocking', a => { let f = 0, n = 0; for (const s of of(a)) { f += s.core_found_blocking; n += s.core_total; } return `${f}/${n} (${pct(f, n)})`; });
row('All known issues, any category', a => { let f = 0, n = 0; for (const s of of(a)) { f += s.all_found; n += s.all_total; } return `${f}/${n} (${pct(f, n)})`; });
row('Core issues found, Gemini judge', a => { const p = pooled(a, CORE, 'gemini'); return p.n ? `${p.f}/${p.n} (${pct(p.f, p.n)})` : 'n/a'; });
row('Median distinct problems raised', a => median(of(a).map(s => s.distinct_problems_raised).filter(x => x != null)) ?? 'n/a');
row('Known issues found / problems raised', a => { let f = 0, n = 0; for (const s of of(a)) { if (s.distinct_problems_raised) { f += s.all_found; n += s.distinct_problems_raised; } } return pct(f, n); });
row('Median review length (characters)', a => median(of(a).map(s => s.review_chars)) ?? 'n/a');
L.push('');
for (const [x, y] of [['mixed', 'single'], ['mixed', 'solo'], ['solo', 'single']]) if (armsSeen.includes(x) && armsSeen.includes(y) && pooled(x, CORE, 'gemini').n) L.push(`- Gemini judge: ${compare(x, y, 'gemini')}`);

// Judge agreement on every (run, issue) pair both judges scored.
let agree = 0, both = 0;
for (const r of runs) if (r.gemini && r.gemini.status === 'OK') for (const [id, g] of Object.entries(r.score.found)) { const h = r.gemini.found[id]; if (h) { both++; if (h.found === g.found) agree++; } }
if (both) L.push(`- The two judges agree on ${agree} of ${both} (run, known issue) decisions (${pct(agree, both)}).`);
L.push('');

L.push('## Which seat raised the issues the council found (Claude judge, core issues)', '', '| Arm | Found | Lead PM first draft | Chief Engineer | Chief Architect | Only Lead PM or Chief Architect |', '| --- | --- | --- | --- | --- | --- |');
for (const a of ['mixed', 'solo'].filter(x => armsSeen.includes(x))) {
  let n = 0, lead = 0, eng = 0, arch = 0, other = 0;
  for (const r of runs.filter(x => x.arm === a)) {
    const kind = Object.fromEntries(r.sections.map(s => [s.id, s]));
    for (const g of Object.values(r.score.found)) {
      if (!g.core || !g.found) continue;
      n++;
      const raised = g.sections.map(id => kind[id]).filter(s => s && !/final draft/.test(s.kind));
      // The user-facing findings list repeats earlier rounds; credit it only when no round raised the issue.
      const rounds = raised.filter(s => !s.summary);
      const seats = new Set((rounds.length ? rounds : raised).map(s => s.seat).filter(x => x !== 'council'));
      if (seats.has('lead')) lead++;
      if (seats.has('engineer')) eng++;
      if (seats.has('architect')) arch++;
      if (!seats.has('engineer') && seats.size) other++;
    }
  }
  L.push(`| ${a} | ${n} | ${lead} | ${eng} | ${arch} | ${other} |`);
}
L.push('', 'In the mixed arm the Lead PM is Gemini and the Chief Architect is Grok, so the last column counts issues no Claude seat raised. A final draft that only repeats an earlier objection is not counted as the Lead PM raising it, and the findings list of the review the user is shown counts for the seat it credits only when no round raised the issue.', '');

L.push('## Time and cost', '', '| Arm | Runs | Median time | Claude cost per run (API price) | Median Claude tokens | Gemini calls per run | Grok calls per run |', '| --- | --- | --- | --- | --- | --- | --- |');
for (const a of armsSeen) {
  const rs = runs.filter(r => r.arm === a);
  const costs = rs.map(r => r.claude_cost).filter(x => x != null);
  L.push(`| ${a} | ${rs.length} | ${mins(median(rs.map(r => r.seconds).filter(Boolean)))} | ${costs.length ? money(costs.reduce((x, y) => x + y, 0) / costs.length) : 'n/a'} | ${median(rs.map(r => r.tokens)) ?? 'n/a'} | ${(rs.reduce((x, r) => x + r.gemini_calls, 0) / rs.length).toFixed(1)} | ${(rs.reduce((x, r) => x + r.grok_calls, 0) / rs.length).toFixed(1)} |`);
}
L.push('', 'Claude cost is the API-price figure Claude Code reports for each call; on a plan nothing is billed per call. Gemini and Grok report no cost, so only their call counts are shown. Judge calls are not included.', '');
const models = [...new Set(runs.flatMap(r => r.claude_models.concat(r.other_models)))];
if (models.length) L.push(`Models seen in the calls: ${models.join(', ')}`, '');

if (unscored.length) {
  L.push('## Not scored yet', '');
  for (const u of unscored) L.push(`- ${u.task} ${u.arm} run ${u.n}: ${u.status}${u.detail ? `: ${String(u.detail).slice(0, 160)}` : ''}`);
  L.push('');
}

L.push('## Every run', '', 'Each line lists the known issues the Claude judge found, with the judge\'s quote, for checking by hand.', '');
for (const r of runs.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.n - b.n)) {
  const s = r.score;
  const hits = Object.entries(s.found).filter(([, g]) => g.found);
  L.push(`- **${r.task} ${r.arm} ${r.n}: ${s.core_found}/${s.core_total} core** (${mins(r.seconds)}${r.claude_cost != null ? `, ${money(r.claude_cost)}` : ''})${hits.length ? '' : ': none found'}`);
  for (const [id, g] of hits) L.push(`  - ${id} [${g.severity}${g.core ? '' : ', not core'}] in ${g.sections.join(', ')}: "${g.quote.replace(/\s+/g, ' ').slice(0, 160)}"`);
}
const preflight = read(path.join(res, 'preflight.txt'));
if (preflight) L.push('', '## Preflight', '', '```', preflight.trim().slice(-4000), '```');

fs.writeFileSync(path.join(res, '..', 'summary.md'), L.join('\n') + '\n');
fs.writeFileSync(path.join(res, '..', 'summary.json'), JSON.stringify({ runs: runs.map(({ sections, ...r }) => r), unscored }, null, 2));
console.log(L.slice(0, 30).join('\n'));
