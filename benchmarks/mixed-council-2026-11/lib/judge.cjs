#!/usr/bin/env node
// The judge step, in two halves around the judge model's call.
//   node judge.cjs prompt <run dir> <tasks.json> <task id>              -> prints the judge prompt
//   node judge.cjs parse  <run dir> <tasks.json> <task id> <arm> <judge> <answer file>
//        -> writes <run dir>/judge-<judge>.json; for the primary judge (claude) also score.json
'use strict';
const fs = require('fs');
const path = require('path');
const [mode, runDir, tasksFile, taskId, arm, judge, answerFile] = process.argv.slice(2);
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const task = JSON.parse(read(tasksFile)).tasks.find(t => t.id === taskId);
if (!task) { console.error(`unknown task ${taskId}`); process.exit(2); }

if (mode === 'prompt') {
  const golden = task.golden.map(g => `${g.id}: ${g.comment}`).join('\n');
  const tpl = read(path.join(__dirname, 'judge-prompt.md'));
  process.stdout.write(tpl.replace('{{GOLDEN}}', golden).replace('{{REVIEW}}', read(path.join(runDir, 'review.md'))));
  process.exit(0);
}

const sections = JSON.parse(read(path.join(runDir, 'sections.json')) || '[]');
const byId = Object.fromEntries(sections.map(s => [s.id, s]));
const raw = read(answerFile);
let ans = null;
for (const m of raw.matchAll(/\{[\s\S]*\}/g)) { try { ans = JSON.parse(m[0]); break; } catch { /* try the next */ } }
if (!ans) {
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  try { ans = JSON.parse(raw.slice(s, e + 1)); } catch { ans = null; }
}
const res = { task: task.id, arm, run: path.basename(runDir), judge };
if (!ans || !Array.isArray(ans.issues)) {
  res.status = 'JUDGE-ERROR';
  res.detail = raw.trim().slice(0, 300);
} else {
  const found = {};
  for (const g of task.golden) {
    const a = ans.issues.find(x => x && x.id === g.id) || { found: false, sections: [] };
    const secs = (Array.isArray(a.sections) ? a.sections : []).filter(id => byId[id]);
    const yes = a.found === true && secs.length > 0;
    found[g.id] = {
      found: yes,
      severity: g.severity, category: g.category, core: g.core,
      sections: yes ? secs : [],
      seats: yes ? [...new Set(secs.map(id => byId[id].seat))] : [],
      blocking: yes && secs.some(id => byId[id].blocking),
      quote: yes ? String(a.quote || '').slice(0, 300) : '',
      reasoning: String(a.reasoning || '').slice(0, 300)
    };
    if (a.found === true && !secs.length) found[g.id].note = 'judge said found but named no valid section';
  }
  const count = f => Object.values(found).filter(f).length;
  const hc = g => g.severity === 'High' || g.severity === 'Critical';
  Object.assign(res, {
    status: 'OK',
    found,
    core_found: count(x => x.core && x.found), core_total: count(x => x.core),
    hc_found: count(x => hc(x) && x.found), hc_total: count(x => hc(x)),
    all_found: count(x => x.found), all_total: task.golden.length,
    core_found_blocking: count(x => x.core && x.found && x.blocking),
    distinct_problems_raised: Number.isFinite(+ans.distinct_problems_raised) ? +ans.distinct_problems_raised : null,
    blocking_sections: sections.filter(s => s.blocking).length,
    review_chars: sections.reduce((a, s) => a + s.chars, 0)
  });
}
fs.writeFileSync(path.join(runDir, `judge-${judge}.json`), JSON.stringify(res, null, 2));
if (judge === 'claude') fs.writeFileSync(path.join(runDir, 'score.json'), JSON.stringify(res, null, 2));
console.log(res.status === 'OK' ? `${task.id} ${arm} ${res.run}: ${res.core_found}/${res.core_total} known issues (judge ${judge})` : `${task.id} ${arm} ${res.run}: ${res.status} (judge ${judge})`);
