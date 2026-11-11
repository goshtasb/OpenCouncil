#!/usr/bin/env node
// SPIKE probe, run on a Mac where `agy` is installed and signed in. It answers the questions the
// happy-agent spike could not answer without a real Gemini login:
//   A. Does today's CLI adapter (agy -p, --mode plan) let a "read-only" seat write? (issue #46)
//   B. Does `agy acp` in plan mode, with every permission ask refused, stop the same write?
//      This is the exact mechanism happy-agent uses for its Read only mode on Antigravity.
//   C. Control: the same prompt in accept-edits mode DOES write, so B's result means something.
//   D. Which slash commands and modes does `agy acp` advertise?
//   E. When agy dies mid-turn, how fast and how clearly does the seat fail?
// It prints a plain-text report. It never prints credentials, and redacts every URL it sees.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const { AcpAdapter } = require(path.join(root, 'dist', 'adapters', 'acp.js'));
const redact = (s) => String(s || '').replace(/https?:\/\/\S+/g, '<url>').replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<long-token>');
const line = (s = '') => console.log(redact(s));
const TIMEOUT = Number(process.env.PROBE_TIMEOUT_SECONDS || 300);

function workspace(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oc-probe-${tag}-`));
  fs.writeFileSync(path.join(dir, 'README.md'), '# probe workspace\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const writePrompt = (dir) =>
  `Create a new file at ${path.join(dir, 'council-probe.txt')} containing the single word PROBE. ` +
  `Use your file writing tool to do it. Then reply with one line: DONE, or the reason you could not.`;
const wrote = (dir) => fs.existsSync(path.join(dir, 'council-probe.txt'));
const short = (s, n = 240) => redact(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, n);

async function acpCase(label, mode, prompt, dir, opts = {}) {
  const adapter = new AcpAdapter({ name: 'antigravity-acp', command: opts.command || 'agy', args: opts.args || ['acp'] });
  const t = Date.now();
  try {
    const out = await adapter.runPrompt(prompt, { cwd: dir, permissionMode: mode, timeoutSeconds: opts.timeout || TIMEOUT });
    return { label, ok: true, seconds: (Date.now() - t) / 1000, answer: short(out), report: adapter.lastReport };
  } catch (err) {
    return { label, ok: false, seconds: (Date.now() - t) / 1000, error: short(`${err.message} ${err.stderr || ''}`, 400), timedOut: !!err.timedOut, report: adapter.lastReport };
  }
}

function printCase(r, dir) {
  line(`- result: ${r.ok ? 'answered' : r.timedOut ? 'TIMED OUT' : 'ERROR'} in ${r.seconds.toFixed(1)}s`);
  if (dir) line(`- file written: ${wrote(dir) ? 'YES' : 'no'}`);
  if (r.answer) line(`- answer: ${r.answer}`);
  if (r.error) line(`- error: ${r.error}`);
  const rep = r.report || {};
  line(`- mode set: ${rep.modeSet || '(none)'}`);
  line(`- permission asks: ${(rep.permissionAsks || []).map(a => `${a.kind || '?'}:${a.answer}`).join(', ') || 'none'}`);
  line(`- tool calls it ran: ${(rep.toolCalls || []).map(c => `${c.kind || '?'}(${c.status || '?'})`).join(', ') || 'none'}`);
}

(async () => {
  line('OpenCouncil happy-agent spike: agy read-only probe');
  line(`date: ${new Date().toISOString()}  node: ${process.version}  os: ${os.platform()} ${os.release()}`);
  let version = '';
  try { version = execFileSync('agy', ['--version'], { encoding: 'utf8', timeout: 20000 }).trim(); } catch (e) { version = `NOT FOUND (${e.code || e.message})`; }
  line(`agy --version: ${version}`);
  line();

  // A. Today's CLI path, the same argv as src/adapters/antigravity.ts uses for a plan seat.
  line('A. Current CLI adapter, plan seat (agy -p --mode plan --dangerously-skip-permissions --disable-slash-commands)');
  {
    const dir = workspace('cli');
    const t = Date.now();
    const res = spawnSync('agy', ['-p', writePrompt(dir), '--add-dir', dir, '--output-format', 'text', '--print-timeout', `${TIMEOUT}s`,
      '--disable-slash-commands', '--mode', 'plan', '--dangerously-skip-permissions'], { cwd: dir, encoding: 'utf8', timeout: (TIMEOUT + 30) * 1000 });
    line(`- exit: ${res.status} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    line(`- file written: ${wrote(dir) ? 'YES (read-only broken, as #46 says)' : 'no'}`);
    line(`- stdout: ${short(res.stdout)}`);
    line(`- stderr: ${short(res.stderr)}`);
  }
  line();

  line('B. agy acp, plan mode, every permission ask refused (happy-agent\'s Read only mechanism)');
  const dirB = workspace('acp-plan');
  const b = await acpCase('B', 'plan', writePrompt(dirB), dirB);
  printCase(b, dirB);
  line();

  line('C. Control: agy acp, accept-edits mode, edit asks allowed');
  const dirC = workspace('acp-exec');
  const c = await acpCase('C', 'exec', writePrompt(dirC), dirC);
  printCase(c, dirC);
  line();

  line('D. What agy acp advertises');
  const rep = b.report || c.report || {};
  for (const [id, values] of Object.entries(rep.advertised || {})) line(`- option ${id}: ${values.join(', ')}`);
  line(`- slash commands announced: ${(rep.commands || []).join(', ') || 'none'}`);
  {
    const dirD = workspace('acp-slash');
    const d = await acpCase('D', 'plan', '/help', dirD, { timeout: 120 });
    line(`- answer to a bare "/help" prompt in plan mode: ${d.ok ? d.answer : `ERROR ${d.error}`}`);
  }
  line();

  line('E. agy acp killed 15s into a long turn');
  {
    const dirE = workspace('acp-die');
    const e = await acpCase('E', 'plan', 'Read every file in your workspace, then write a 3000 word essay about software review. Take your time.', dirE,
      { command: '/bin/sh', args: ['-c', 'exec 3<&0; agy acp <&3 & P=$!; sleep 15; kill -9 $P; wait $P'], timeout: 120 });
    printCase(e);
  }
  line();
  line('SUMMARY');
  line(`- #46 reproduced on CLI path: see A`);
  line(`- ACP plan blocked the write: ${wrote(dirB) ? 'NO' : 'yes'}${b.ok ? '' : ' (but the run errored, see B)'}`);
  line(`- ACP control wrote the file: ${wrote(dirC) ? 'yes' : 'NO (the prompt may not induce a write; B proves less)'}`);
})().catch(err => { line(`probe crashed: ${err.stack || err}`); process.exitCode = 1; });
