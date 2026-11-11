#!/usr/bin/env node
// Builds the single agent's prompt from single-agent-prompt.md and the fixture's diff.
// Usage: node make-prompt.cjs <template> <repo dir> <base>   (prompt on stdout)
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const [tpl, repo, base] = process.argv.slice(2);
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const diff = git(['diff', '--no-color', `${base}...HEAD`]).trimEnd();
const files = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
process.stdout.write(fs.readFileSync(tpl, 'utf8')
  .replace('{{BASE}}', () => base).replace('{{COUNT}}', () => String(files.length))
  .replace('{{FILES}}', () => files.join(', ')).replace('{{DIFF}}', () => diff));
