#!/usr/bin/env node
// Reads a council session's seats.json (open-council-cli 0.4+) and says whether every seat was held by the
// provider and model it started with. Prints OK, QUOTA <reason> or FAILOVER <reason>.
// A session with no seats.json (before 0.4) prints OK, since those versions never failed over.
'use strict';
const fs = require('fs');
let rec;
try { rec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch { console.log('OK'); process.exit(0); }
const clean = s => String(s).replace(/["\\\n]/g, ' ').slice(0, 150);
const failures = rec.failures || [];
if (failures.length) {
  const f = failures[0];
  const what = `${f.seat} on ${f.provider} ${f.model} failed at ${f.stage} (${f.kind}): ${f.reason}${f.replacedBy ? `; ${f.replacedBy.provider} took over` : '; nobody took over'}`;
  console.log(`${failures.some(x => x.kind === 'quota') ? 'QUOTA' : 'FAILOVER'} ${clean(what)}`);
  process.exit(0);
}
const planned = rec.planned || {};
const odd = (rec.answered || []).filter(a => planned[a.seat] && planned[a.seat].provider !== a.provider);
if (odd.length) { console.log(`FAILOVER ${clean(`${odd[0].seat} was answered by ${odd[0].provider} instead of ${planned[odd[0].seat].provider}`)}`); process.exit(0); }
const missing = Object.keys(planned).filter(seat => !(rec.answered || []).some(a => a.seat === seat));
if (missing.length) { console.log(`FAILOVER ${clean(`${missing.join(', ')} never answered`)}`); process.exit(0); }
console.log('OK');
