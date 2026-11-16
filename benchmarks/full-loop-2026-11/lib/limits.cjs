#!/usr/bin/env node
'use strict';
// Did a run (or its judge) stop on a usage limit or a sign-in prompt? Reads only what the CLIs themselves
// report: Claude's error results in the call logs, and each CLI's stderr. Model text (stdout, the council's
// own log) is never read, so a task about quotas or rate limits can't be mistaken for one.
//   node limits.cjs <run dir> <run|single|judge>
// Prints one line: "signin", "limit <vendor> [<vendor>...]: <first matching text>", or nothing.
const fs = require('fs');
const path = require('path');
const [dir, mode] = process.argv.slice(2);
const LIMIT = /usage limit|limit reached|hit your (usage |weekly |session |daily )?limit|weekly limit|rate.?limit|quota|resource.?exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)|\b429\b/i;
const SIGNIN = /accounts\.google\.com|paste (this|the) code|authorization code|(sign|log) ?in (again|required|to continue)|not (signed|logged) in|re-?authenticat/i;
const read = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const hits = new Map();
const hit = (vendor, s) => { if (!hits.has(vendor)) hits.set(vendor, s.replace(/\s+/g, ' ').trim().slice(0, 160)); };

const jsonl = mode === 'judge' ? ['judge-calls.jsonl'] : ['calls.jsonl'];
for (const f of jsonl) for (const line of read(f).split('\n')) {
  let c; try { c = JSON.parse(line); } catch { continue; }
  if (c.vendor === 'claude' && (c.is_error || c.parse_error) && typeof c.error === 'string' && LIMIT.test(c.error)) hit('claude', c.error);
}
const stderr = mode === 'judge' ? { claude: ['flip.err'] }
  : mode === 'single' ? { claude: ['cli.log'] }
  : { claude: ['claude-stderr.log'], gemini: ['agy-stderr.log'], grok: ['grok-stderr.log'] };
let signin = false;
for (const [vendor, files] of Object.entries(stderr)) for (const f of files) {
  const t = read(f);
  if (vendor === 'gemini' && SIGNIN.test(t)) signin = true;
  const m = t.split('\n').find(l => LIMIT.test(l));
  if (m) hit(vendor, m);
}
if (signin) console.log('signin');
else if (hits.size) console.log(`limit ${[...hits.keys()].join(' ')}: ${[...hits.values()][0]}`);
