#!/usr/bin/env node
// SPIKE probe, run on a Mac where `agy` is installed and signed in. It answers the questions the
// happy-agent spike could not answer without a real Gemini login:
//   A. Does today's CLI adapter (agy -p, --mode plan) let a "read-only" seat write? (issue #46)
//   B. Does `agy acp` in plan mode, with every permission ask refused, stop the same write?
//      This is the exact mechanism happy-agent uses for its Read only mode on Antigravity.
//   C. Control: the same prompt, agy's most permissive mode, every ask allowed, DOES write, so B's
//      result means something. If it still doesn't write, C2 retries with our filesystem offered
//      to agy (ACP fs/write_text_file), in case agy only writes through the client.
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
  // realpath: on macOS the temp dir is /var/... but really /private/var/..., and agy can treat the
  // two as different places, refusing a "workspace" path that isn't under its real root.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `oc-probe-${tag}-`)));
  fs.writeFileSync(path.join(dir, 'README.md'), '# probe workspace\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
const writePrompt = (dir) =>
  `Your workspace is exactly the directory ${dir}. It is a scratch git repository made for this test, ` +
  `and you have permission to change it.\n\n` +
  `Create a new file named council-probe.txt in your workspace (absolute path ${path.join(dir, 'council-probe.txt')}) ` +
  `whose whole content is the single word PROBE. Actually create the file with one of your tools; do not just describe it. ` +
  `Then reply with one line: DONE, or the exact reason you could not, naming the tool you tried.`;
const wrote = (dir) => fs.existsSync(path.join(dir, 'council-probe.txt'));
const short = (s, n = 240) => redact(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, n);

// An answer that is agy's quota or rate-limit notice means the model never ran: no result, not a block.
const isQuota = (s) => /quota (reached|exceeded|exhausted)|upgrade your subscription|resource_exhausted|rate limit|too many requests|capacity_exhausted/i.test(String(s || ''));
let MODEL; // set by the preflight: undefined means agy's default model

async function acpCase(label, mode, prompt, dir, opts = {}) {
  const adapter = new AcpAdapter({ name: 'antigravity-acp', command: opts.command || 'agy', args: opts.args || ['acp'], modes: opts.modes, clientFs: opts.clientFs });
  const t = Date.now();
  try {
    const out = await adapter.runPrompt(prompt, { cwd: dir, permissionMode: mode, timeoutSeconds: opts.timeout || TIMEOUT, model: MODEL });
    if (isQuota(out)) return { label, ok: false, quota: true, seconds: (Date.now() - t) / 1000, error: short(out), report: adapter.lastReport };
    return { label, ok: true, seconds: (Date.now() - t) / 1000, answer: short(out, 600), report: adapter.lastReport };
  } catch (err) {
    const msg = `${err.message} ${err.stderr || ''}`;
    return { label, ok: false, quota: isQuota(msg), seconds: (Date.now() - t) / 1000, error: short(msg, 400), timedOut: !!err.timedOut, report: adapter.lastReport };
  }
}

function printCase(r, dir) {
  line(`- result: ${r.ok ? 'answered' : r.quota ? 'NO RESULT (agy quota or rate limit, the model never ran)' : r.timedOut ? 'TIMED OUT' : 'ERROR'} in ${r.seconds.toFixed(1)}s`);
  if (dir) line(`- file written: ${wrote(dir) ? 'YES' : 'no'}`);
  if (r.answer) line(`- answer: ${r.answer}`);
  if (r.error) line(`- error: ${r.error}`);
  const rep = r.report || {};
  line(`- mode set: ${rep.modeSet || '(none)'}`);
  const asks = rep.permissionAsks || [];
  line(`- permission asks: ${asks.length || 'none'}`);
  for (const a of asks) line(`    ${a.kind || '?'} -> ${a.answer}: ${short(a.title, 160)}`);
  const calls = rep.toolCalls || [];
  line(`- tool calls reported: ${calls.length || 'none'}`);
  for (const c of calls) line(`    ${c.kind || '?'} (${c.status || '?'}): ${short(c.title, 160)}`);
  if ((rep.fsCalls || []).length) for (const f of rep.fsCalls) line(`- client fs: ${f.method} ${f.ok ? 'done' : 'refused (outside workspace)'}: ${short(f.path, 160)}`);
  if (dir && !wrote(dir) && rep.stderrTail) line(`- agy stderr (tail): ${short(rep.stderrTail, 400)}`);
}

// agy's mode names are not documented; for the control pick the most permissive one it offers.
function permissiveModes(advertised) {
  const values = [...((advertised || {}).mode || []), ...((advertised || {})['(session modes)'] || [])];
  const pick = ['auto', 'yolo', 'bypass-permissions', 'bypassPermissions', 'full-access', 'accept-edits', 'acceptEdits', 'default']
    .find(v => values.includes(v));
  return pick ? { plan: 'plan', exec: pick, auto: pick } : undefined;
}

(async () => {
  line('OpenCouncil happy-agent spike: agy read-only probe');
  line(`date: ${new Date().toISOString()}  node: ${process.version}  os: ${os.platform()} ${os.release()}`);
  let version = '';
  try { version = execFileSync('agy', ['--version'], { encoding: 'utf8', timeout: 20000 }).trim(); } catch (e) { version = `NOT FOUND (${e.code || e.message})`; }
  line(`agy --version: ${version}`);
  line();

  // Preflight: find a model that answers at all. agy's plan mode is agy's own tool layer, not the
  // model's, so any model agy offers tests #46. Gemini models share one quota pool.
  line('P. Preflight: which agy model answers right now');
  const candidates = (process.env.PROBE_MODELS || 'default,claude-sonnet-5-5,gpt-oss-120b-medium').split(',').map(m => m.trim()).filter(Boolean);
  let found = false;
  let advertisedAtPreflight;
  for (const m of candidates) {
    MODEL = m === 'default' ? undefined : m;
    const dirP = workspace('preflight');
    const r = await acpCase('P', 'plan', 'Reply with the single word OK and nothing else.', dirP, { timeout: 90 });
    advertisedAtPreflight = advertisedAtPreflight || (r.report || {}).advertised;
    const offered = MODEL === undefined || (((r.report || {}).advertised || {}).model || []).includes(MODEL);
    line(`- ${m}: ${!offered ? 'not offered by this agy' : r.ok ? `answers (${short(r.answer, 60)})` : r.quota ? `quota reached (${short(r.error, 120)})` : `error (${short(r.error, 160)})`}`);
    if (offered && r.ok) { found = true; break; }
  }
  if (!found) {
    line();
    for (const [id, values] of Object.entries(advertisedAtPreflight || {})) line(`- option ${id}: ${values.join(', ')}`);
    line();
    line('SUMMARY');
    line('- NO RESULT: no agy model would answer (quota or error, see P). Nothing about read-only was tested.');
    line('- Rerun once the quota resets, or set PROBE_MODELS to other models agy lists.');
    return;
  }
  line(`- using: ${MODEL || 'agy default model'}`);
  line();

  // A. Today's CLI path, the same argv as src/adapters/antigravity.ts uses for a plan seat.
  line('A. Current CLI adapter, plan seat (agy -p --mode plan --dangerously-skip-permissions --disable-slash-commands)');
  {
    const dir = workspace('cli');
    const t = Date.now();
    const res = spawnSync('agy', ['-p', writePrompt(dir), '--add-dir', dir, '--output-format', 'text', '--print-timeout', `${TIMEOUT}s`,
      '--disable-slash-commands', '--mode', 'plan', '--dangerously-skip-permissions', ...(MODEL ? ['--model', MODEL] : [])], { cwd: dir, encoding: 'utf8', timeout: (TIMEOUT + 30) * 1000 });
    line(`- exit: ${res.status} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    line(`- file written: ${wrote(dir) ? 'YES (read-only broken, as #46 says)' : isQuota(res.stdout + res.stderr) ? 'no, but NO RESULT (agy quota)' : 'no'}`);
    line(`- stdout: ${short(res.stdout)}`);
    line(`- stderr: ${short(res.stderr)}`);
  }
  line();

  line('B. agy acp, plan mode, every permission ask refused (happy-agent\'s Read only mechanism)');
  const dirB = workspace('acp-plan');
  const b = await acpCase('B', 'plan', writePrompt(dirB), dirB);
  printCase(b, dirB);
  line();

  const modes = permissiveModes((b.report || {}).advertised);
  line(`C. Control: agy acp, most permissive mode offered (${modes ? modes.auto : 'none found, agy default'}), every permission ask allowed`);
  const dirC = workspace('acp-control');
  const c = await acpCase('C', 'auto', writePrompt(dirC), dirC, { modes });
  printCase(c, dirC);
  line();

  let dirC2 = null;
  if (!wrote(dirC) && !c.quota) {
    line('C2. Control again, now also offering our filesystem to agy (ACP fs/write_text_file)');
    dirC2 = workspace('acp-control-fs');
    const c2 = await acpCase('C2', 'auto', writePrompt(dirC2), dirC2, { modes, clientFs: true });
    printCase(c2, dirC2);
    line();
  }

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
  line(`- model used: ${MODEL || 'agy default'}`);
  line(`- #46 reproduced on CLI path: see A`);
  line(`- ACP plan blocked the write: ${wrote(dirB) ? 'NO' : b.quota ? 'NO RESULT (agy quota)' : 'yes'}${b.ok || b.quota ? '' : ' (but the run errored, see B)'}`);
  const controlWrote = wrote(dirC) || (dirC2 && wrote(dirC2));
  line(`- ACP control wrote the file: ${wrote(dirC) ? 'yes (C)' : dirC2 && wrote(dirC2) ? 'yes, but only through our filesystem (C2)' : 'NO, see C and C2'}`);
  const quotaHit = [b, c].some(r => r.quota);
  line(`- verdict: ${quotaHit && !controlWrote && !wrote(dirB) ? 'NO RESULT: agy hit its quota mid-run, nothing about read-only was tested'
    : !controlWrote ? 'inconclusive, agy would not write even when allowed'
    : wrote(dirB) ? 'plan mode did NOT stop the write'
    : wrote(dirC) ? 'plan mode stopped a write that agy makes when allowed'
    : 'agy only writes through the client filesystem, which read-only seats never get; B was safe for that reason, not because of plan mode'}`);
})().catch(err => { line(`probe crashed: ${err.stack || err}`); process.exitCode = 1; });
