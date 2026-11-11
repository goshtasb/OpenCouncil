#!/usr/bin/env node
// Turns one run's output into the labelled sections the judge reads, and records what each label is.
// Usage: node review-text.cjs <run dir> <arm>   -> writes <run dir>/review.md and <run dir>/sections.json
// Single arm: result.md split into its Blocking and Non-blocking findings.
// Council arms: the Lead PM's first and final drafts, each Chief Engineer round (open objections apart
// from the rest), each Chief Architect review (REQUIRED concerns apart from ADVISORY), tie-break and questions,
// and the findings list of the review the user is shown (marked summary: true).
'use strict';
const fs = require('fs');
const path = require('path');
const [runDir, arm] = process.argv.slice(2);
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const sections = [];
const add = (seat, kind, blocking, text, summary = false) => {
  const t = String(text || '').trim();
  if (!t) return;
  sections.push({ id: `S${sections.length + 1}`, seat, kind, blocking, summary, text: t });
};

/** One finding per top-level numbered or bulleted item; indented sub-points stay with their item. */
const TOP_ITEM = /^ ?(\*\*)?\d+[.)]\s|^ ?[-*•]\s(?!\s)/;
function items(text) {
  const out = []; let cur = [];
  const flush = () => { const s = cur.join('\n').trim(); if (s) out.push(s); cur = []; };
  for (const line of text.split('\n')) {
    if (TOP_ITEM.test(line)) flush();
    cur.push(line);
  }
  flush();
  return out.filter(s => !/^none\.?$/i.test(s.replace(/[*\s]/g, ' ').trim()));
}

if (arm === 'single') {
  const out = read(path.join(runDir, 'result.md'));
  const block = (out.split(/^#+\s*Blocking\b.*$/im)[1] || '').split(/^#+\s*Non-?blocking\b.*$|^\s*VERDICT:/im)[0];
  const rest = (out.split(/^#+\s*Non-?blocking\b.*$/im)[1] || '').split(/^\s*VERDICT:/im)[0];
  if (!block.trim() && !rest.trim()) add('agent', 'whole review (no sections found)', false, out);
  for (const f of items(block)) add('agent', 'blocking finding', true, f);
  for (const f of items(rest)) add('agent', 'non-blocking finding', false, f);
} else {
  const s = path.join(runDir, 'session');
  const names = fs.existsSync(s) ? fs.readdirSync(s).sort() : [];
  const plans = names.filter(f => /^plan-v\d+\.md$/.test(f)).sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)));
  if (plans.length) add('lead', `Lead PM first draft (${plans[0]})`, false, read(path.join(s, plans[0])));
  for (const d of names) {
    const reply = read(path.join(s, d, 'reply.md'));
    if (!reply) continue;
    if (/^round-/.test(d)) {
      let open = 1;
      try { open = JSON.parse(read(path.join(s, d, 'verdict.json'))).openObjections; } catch { /* no verdict */ }
      // The advisory contract: VERDICT and OPEN OBJECTIONS lines, what was checked, the numbered objections
      // (sometimes under an Objections heading), then optional notes and a Not checked line.
      let body = reply.split(/\n\s*\**\s*Not checked/i)[0], notes = '';
      const nm = /^[ \t]*(?:#+\s*|\*\*)?Notes\b/im.exec(body);
      if (nm && nm.index > 0) { notes = body.slice(nm.index); body = body.slice(0, nm.index); }
      let pre = body, objs = '';
      const heading = body.split(/\n\s*(?:#+\s*|\*\*)?Objections\b[^\n]*\n/i);
      if (heading.length > 1) { pre = heading[0]; objs = heading.slice(1).join('\n'); }
      else { const m = /^(\*\*)?\d+[.)]\s/m.exec(body); if (m) { pre = body.slice(0, m.index); objs = body.slice(m.index); } }
      const list = open === 0 ? [] : heading.length > 1 ? items(objs) : items(objs).filter(f => /^(\*\*)?\d+[.)]\s/.test(f));
      if (list.length) {
        add('engineer', `Chief Engineer ${d}, text before the objections`, false, pre);
        for (const f of list) add('engineer', `Chief Engineer ${d}, objection`, true, f);
      } else {
        add('engineer', `Chief Engineer ${d}${open === 0 ? ' (no open objections)' : ''}`, open !== 0, body);
      }
      add('engineer', `Chief Engineer ${d}, notes`, false, notes);
    } else if (/^review-/.test(d)) {
      const blocks = reply.split(/\n(?=\s*CONCERN\s+\d+)/);
      if (!/^\s*CONCERN\s+\d+/.test(blocks[0])) add('architect', `Chief Architect ${d}, preamble`, false, blocks.shift());
      for (const b of blocks) {
        const req = /REQUIRED/i.test(b.split('\n')[0]);
        add('architect', `Chief Architect ${d}, ${req ? 'REQUIRED' : 'ADVISORY'} concern`, req, b);
      }
    } else if (/^(tiebreak|questions)-/.test(d)) {
      add('architect', `Chief Architect ${d}`, false, reply);
    }
  }
  if (plans.length > 1) add('lead', `Lead PM final draft (${plans[plans.length - 1]})`, false, read(path.join(s, plans[plans.length - 1])));
  // The review the user sees: its "What the council found" list, one section per finding, credited to the
  // seat its own attribution line names. These repeat findings above, so seat attribution skips them.
  const found = (read(path.join(s, 'review.md')).split(/^###\s*What the council found.*$/im)[1] || '').split(/^###\s/m)[0];
  for (const f of items(found)) {
    const who = (f.match(/_\s*(Lead PM|Chief Engineer|Chief Architect)\b[^_]*_\s*$/m) || [])[1] || '';
    const seat = { 'Lead PM': 'lead', 'Chief Engineer': 'engineer', 'Chief Architect': 'architect' }[who] || 'council';
    add(seat, `council review summary, finding credited to ${who || 'no seat'}`, false, f, true);
  }
}

const md = sections.map(x => `=== ${x.id} (${x.kind}) ===\n${x.text}`).join('\n\n');
fs.writeFileSync(path.join(runDir, 'review.md'), md + '\n');
fs.writeFileSync(path.join(runDir, 'sections.json'), JSON.stringify(sections.map(({ text, ...r }) => ({ ...r, chars: text.length })), null, 2));
console.log(`${sections.length} sections, ${md.length} chars`);
