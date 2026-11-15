#!/usr/bin/env node
'use strict';
// Scores one run: the task's original tests plus its hidden tests, against the final working tree.
//   node score.cjs <task dir> <final tree> <out.json>
// The tree is copied first, and the task's own test/ files are put back over any edits the agent
// made to them, so a run can't pass by changing the tests it was given.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const [taskDir, tree, outFile] = process.argv.slice(2);
const TIMEOUT_MS = 180000;

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.git' || name === 'node_modules' || name === '.council') continue;
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.lstatSync(s);
    if (st.isDirectory()) copyTree(s, d);
    else if (st.isFile()) fs.copyFileSync(s, d);
  }
}

function runTests(dir, files) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS });
  const out = (r.stdout || '') + (r.stderr || '');
  // Top-level results only (subtests are indented).
  const tests = [];
  for (const line of out.split('\n')) {
    const m = /^(ok|not ok) \d+ - (.*?)(?: # .*)?$/.exec(line);
    if (m) tests.push({ name: m[2].trim(), ok: m[1] === 'ok' });
  }
  return { exit: r.status, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), tests, output: out.slice(-20000) };
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-score-'));
copyTree(tree, work);
const visibleDir = path.join(taskDir, 'repo', 'test');
fs.mkdirSync(path.join(work, 'test'), { recursive: true });
for (const f of fs.readdirSync(visibleDir)) fs.copyFileSync(path.join(visibleDir, f), path.join(work, 'test', f));
const hiddenFiles = fs.readdirSync(path.join(taskDir, 'hidden')).filter(f => f.endsWith('.js'));
for (const f of hiddenFiles) fs.copyFileSync(path.join(taskDir, 'hidden', f), path.join(work, 'test', f));

const visibleFiles = fs.readdirSync(visibleDir).filter(f => f.endsWith('.test.js')).map(f => `test/${f}`);
const visible = runTests(work, visibleFiles);
const hidden = runTests(work, hiddenFiles.map(f => `test/${f}`));
const result = {
  passed: visible.exit === 0 && hidden.exit === 0 && hidden.tests.length > 0 && hidden.tests.every(t => t.ok),
  visiblePassed: visible.exit === 0,
  hiddenPassed: hidden.exit === 0 && hidden.tests.every(t => t.ok),
  hiddenTests: hidden.tests,
  visibleFailures: visible.tests.filter(t => !t.ok).map(t => t.name),
  timedOut: visible.timedOut || hidden.timedOut
};
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
fs.writeFileSync(outFile.replace(/\.json$/, '') + '-output.txt', `== visible\n${visible.output}\n== hidden\n${hidden.output}`);
fs.rmSync(work, { recursive: true, force: true });
console.log(`${result.passed ? 'PASS' : 'FAIL'} (hidden ${hidden.tests.filter(t => t.ok).length}/${hidden.tests.length}${result.visiblePassed ? '' : ', original tests failing'})`);
