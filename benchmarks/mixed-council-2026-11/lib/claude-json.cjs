#!/usr/bin/env node
// Used by the claude wrapper: prints the text answer from `claude -p --output-format json` (what the
// council expects on stdout) and appends that call's model, tokens and API-price cost to the run's log.
// Usage: node claude-json.cjs <json file> <log file> <model alias> <seconds> <exit code>
'use strict';
const fs = require('fs');
const [file, log, alias, seconds, code] = process.argv.slice(2);
const raw = fs.readFileSync(file, 'utf8');
let j = null;
try { j = JSON.parse(raw); } catch { /* not JSON: pass it through untouched */ }
if (!j || typeof j !== 'object') {
  process.stdout.write(raw);
  if (log) fs.appendFileSync(log, JSON.stringify({ vendor: 'claude', alias, seconds: +seconds, code: +code, parse_error: true }) + '\n');
  process.exit(0);
}
process.stdout.write(typeof j.result === 'string' ? j.result : '');
const u = j.usage || {};
const entry = {
  vendor: 'claude', alias, models: Object.keys(j.modelUsage || {}), seconds: +seconds, code: +code,
  is_error: !!j.is_error, cost_usd: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
  input_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
  output_tokens: u.output_tokens || 0
};
if (j.is_error) entry.error = String(j.result || j.subtype || '').slice(0, 300);
if (log) fs.appendFileSync(log, JSON.stringify(entry) + '\n');
