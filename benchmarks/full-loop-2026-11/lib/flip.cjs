#!/usr/bin/env node
'use strict';
// Late sign-off concerns vs the hidden tests a council run failed.
//   node flip.cjs prompt <run dir> <task dir>   prints the judge prompt (nothing when there is nothing to judge)
//   node flip.cjs parse  <run dir> <task dir>   reads flip.answer.txt, writes flip.json
// "Late" means raised at the sign-off stage (the Chief Architect's review or the Lead's sign-off),
// after the Chief Engineer ratified the plan. A concern "would have flipped the gate" when it names
// the problem behind a hidden test this run failed: had it blocked sign-off, that problem was on the table.
// The same judge also says whether the council's final plan (the signed-off brief, or the stalled draft)
// named the problem, to tell "never saw it" apart from "saw it and left it out of scope".
const fs = require('fs');
const path = require('path');
const [mode, runDir, taskDir] = process.argv.slice(2);

function lateSignoffs() {
  const sess = path.join(runDir, 'session');
  if (!fs.existsSync(sess)) return [];
  const out = [];
  for (const d of fs.readdirSync(sess).sort()) {
    if (!/^(review|signoff)-\d+$/.test(d)) continue;
    const f = path.join(sess, d, 'reply.md');
    if (fs.existsSync(f)) out.push({ stage: d, text: fs.readFileSync(f, 'utf8').trim() });
  }
  return out;
}
function finalPlan() {
  for (const f of ['brief-and-prd.md', 'stalled-draft-and-objections.md']) {
    const p = path.join(runDir, 'session', f);
    if (fs.existsSync(p)) return { file: f, text: fs.readFileSync(p, 'utf8').trim() };
  }
  return null;
}
function failingHidden() {
  const t = path.join(runDir, 'tests.json');
  if (!fs.existsSync(t)) return [];
  return JSON.parse(fs.readFileSync(t, 'utf8')).hiddenTests.filter(x => !x.ok).map(x => x.name);
}

const late = lateSignoffs();
const plan = finalPlan();
const failing = failingHidden();
const judged = failing.length > 0 && (late.length > 0 || plan);

if (mode === 'prompt') {
  if (!judged) process.exit(0);
  const hiddenSrc = fs.readdirSync(path.join(taskDir, 'hidden')).map(f => fs.readFileSync(path.join(taskDir, 'hidden', f), 'utf8')).join('\n');
  process.stdout.write(`You are scoring a software benchmark. A council of AI reviewers planned and built a change. After its Chief Engineer ratified the plan, two more seats gave sign-off reviews (below). The built change then failed some hidden acceptance tests.

For each failing hidden test, answer two questions.
1. Does any sign-off review below name the same underlying problem, clearly enough that a developer reading it would have fixed it? Naming a related area, or citing a risk only by its id, is not enough; it must point at the behaviour the test checks.
2. Does the council's final plan (below the reviews) describe that same problem, whether it then fixes it, defers it or rules it out of scope? Same bar: it must point at the behaviour the test checks.
Quote the sentence that does, for each, if one does.

Answer with JSON only, in this shape:
{"items":[{"test":"<test name exactly as given>","named":true|false,"stage":"<review-NN or signoff-NN, or empty>","quote":"<sentence, or empty>","inPlan":true|false,"planQuote":"<sentence, or empty>"}]}

## Failing hidden tests
${failing.map(n => `- ${n}`).join('\n')}

## Hidden test source (for what each test checks)
\`\`\`js
${hiddenSrc}
\`\`\`

## Sign-off reviews
${late.length ? late.map(l => `### ${l.stage}\n${l.text}`).join('\n\n') : '(none: the council never reached sign-off)'}

## The council's final plan (${plan ? plan.file : 'none'})
${plan ? plan.text : '(none)'}
`);
  process.exit(0);
}

if (mode === 'parse') {
  const result = { status: 'OK', failingHidden: failing.length, lateSignoffs: late.length, items: [] };
  if (judged) {
    const ansFile = path.join(runDir, 'flip.answer.txt');
    const raw = fs.existsSync(ansFile) ? fs.readFileSync(ansFile, 'utf8') : '';
    const m = raw.match(/\{[\s\S]*\}/);
    let parsed = null;
    try { parsed = m && JSON.parse(m[0]); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed.items)) {
      result.status = 'JUDGE-ERROR';
    } else {
      result.items = parsed.items.filter(i => failing.includes(i.test)).map(i => ({ test: i.test, named: !!i.named, stage: i.stage || '', quote: String(i.quote || '').slice(0, 400), inPlan: !!i.inPlan, planQuote: String(i.planQuote || '').slice(0, 400) }));
    }
  }
  result.wouldFlip = result.items.filter(i => i.named).length;
  result.inPlan = result.items.filter(i => i.inPlan).length;
  fs.writeFileSync(path.join(runDir, 'flip.json'), JSON.stringify(result, null, 2));
  if (result.status !== 'OK') process.exitCode = 1;
}
