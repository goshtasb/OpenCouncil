// `council polish`: blind critiques, one anonymous merge, an optional single rebuttal. Every seat is scripted; no model is called.
process.env.COUNCIL_RETRY_DELAY_MS = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { lib, home, ScriptedAdapter } = require('./helpers.cjs');

const bin = path.join(__dirname, '..', 'bin', 'council.js');
const IDEA = 'Borrowers\' personal agents shop for loans; lenders publish pricing through one protocol.';

const CRITIQUE = (who) => [
  '## STRONGEST VERSION', `A protocol for agent loan shopping, per ${who}.`, '',
  '## WEAKEST POINTS', `1. **Lenders will not share pricing (${who}).** Margin.`, '',
  '## WHAT TO ADD', `1. Signed rate quotes (${who}).`, '',
  '## OPEN QUESTIONS', '1. Who pays?'
].join('\n');
const MERGED = [
  '## POLISHED IDEA', 'An open quote protocol for borrower agents.', '',
  '## WHAT CHANGED', '1. Signed quotes (A, C).', '',
  '## DISAGREEMENTS', '1. Free vs paid lender access: A says free, B says paid. Lean free.', '',
  '## OPEN QUESTIONS FOR YOU', '1. Which loan type first?'
].join('\n');

let n = 0;
function seats(critics = 3) {
  n++;
  const list = Array.from({ length: critics }, (_, i) => new ScriptedAdapter(`fake-critic-${n}-${i}`, []));
  const merger = new ScriptedAdapter(`fake-merger-${n}`, []);
  for (const a of [...list, merger]) lib.registerAdapter(a.name, a);
  return { list, merger, critics: list.map(a => ({ provider: a.name, model: 'm' })), mergerSeat: { provider: merger.name, model: 'mm' } };
}
const out = () => fs.mkdtempSync(path.join(os.tmpdir(), 'polish-out-'));

test('default run: one blind call per critic and one merge, 4 calls with three critics', async () => {
  const s = seats();
  s.list.forEach((a, i) => a.responses.push(CRITIQUE(`seat${i}`)));
  s.merger.responses.push(MERGED);
  const r = await lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: out(), random: () => 0 });
  assert.equal(r.calls, 4);
  assert.equal(lib.plannedCalls(3, false), 4);
  assert.deepEqual(s.list.map(a => a.calls.length), [1, 1, 1]);
  assert.equal(s.merger.calls.length, 1);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.sections['POLISHED IDEA'], 'An open quote protocol for borrower agents.');
});

test('the blind pass is blind: every critic gets the same prompt, with the idea and no other critique', async () => {
  const s = seats();
  const seen = [];
  s.list.forEach((a, i) => a.responses.push((p, o) => { seen.push(fs.readdirSync(o.cwd).length); return CRITIQUE(`seat${i}`); }));
  s.merger.responses.push(MERGED);
  await lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: out() });
  assert.deepEqual(seen, [0, 0, 0], 'every seat runs in an empty workspace');
  assert.ok(!fs.existsSync(s.list[0].calls[0].options.cwd), 'the empty workspace is removed afterwards');
  const prompts = s.list.map(a => a.calls[0].prompt);
  assert.ok(prompts.every(p => p === prompts[0]), 'identical prompt for every critic');
  assert.ok(prompts[0].includes(IDEA));
  assert.doesNotMatch(prompts[0], /seat\d/, 'no critique leaks into the blind pass');
  for (const a of s.list) {
    assert.equal(a.calls[0].options.permissionMode, undefined, 'no tools');
  }
});

test('the merger sees anonymous letters, never which model wrote what, and the shuffle sets the letters', async () => {
  const s = seats();
  s.list.forEach((a, i) => a.responses.push(CRITIQUE(`seat${i}`)));
  s.merger.responses.push(MERGED);
  const dir = out();
  // random() = 0 reverses three items: seat2 becomes A, seat0 becomes B, seat1 becomes C.
  const r = await lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: dir, random: () => 0 });
  const prompt = s.merger.calls[0].prompt;
  assert.match(prompt, /<critique from="Critic A">\n## STRONGEST VERSION\nA protocol for agent loan shopping, per seat1/);
  for (const a of s.list) assert.ok(!prompt.includes(a.name), 'no provider name reaches the merger');
  assert.match(prompt, /Do not force a consensus/);
  const md = fs.readFileSync(r.mdPath, 'utf8');
  assert.match(md, /## Disagreements\n\n1\. Free vs paid lender access/);
  const who = md.slice(md.indexOf('## Who was who'));
  for (const c of r.critics) assert.match(who, new RegExp(`Critic ${c.label}: ${c.name.replace(/[()]/g, '\\$&')}`));
  assert.ok(fs.existsSync(path.join(dir, 'polish.json')));
});

test('--rebuttal: one reply per critic to the merged version, shown as is, no second merge (7 calls)', async () => {
  const s = seats();
  s.list.forEach((a, i) => a.responses.push(CRITIQUE(`seat${i}`), i === 1 ? 'NO OBJECTIONS' : `1. **It drops lender liability (seat${i}).**`));
  s.merger.responses.push(MERGED);
  const r = await lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, rebuttal: true, outDir: out() });
  assert.equal(r.calls, 7);
  assert.equal(lib.plannedCalls(3, true), 7);
  assert.equal(s.merger.calls.length, 1, 'the rebuttals are not merged again');
  for (const a of s.list) assert.ok(a.calls[1].prompt.includes('An open quote protocol for borrower agents.'), 'each critic sees the merged version');
  const md = fs.readFileSync(r.mdPath, 'utf8');
  assert.match(md, /## Rebuttals to the merged version/);
  assert.match(md, /_No objections._/);
  assert.match(md, /It drops lender liability \(seat0\)/);
});

test('a critic that fails is a gap, not a failed run; the rest are merged', async () => {
  const s = seats();
  s.list[0].responses.push(() => { throw new Error('agy: not signed in'); });
  s.list[1].responses.push(CRITIQUE('seat1'));
  s.list[2].responses.push(CRITIQUE('seat2'));
  s.merger.responses.push(MERGED);
  const r = await lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: out() });
  assert.equal(r.gaps.length, 1);
  assert.match(r.gaps[0], /gave no critique: agy: not signed in/);
  assert.doesNotMatch(s.merger.calls[0].prompt, /Critic C/, 'only two critiques reach the merger');
  assert.match(fs.readFileSync(r.mdPath, 'utf8'), /no critique \(agy: not signed in\)/);
});

test('no critic answers: the run stops before the merge', async () => {
  const s = seats(2);
  s.list.forEach(a => a.responses.push(() => { throw new Error('usage limit'); }));
  await assert.rejects(lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: out() }), /No critic answered/);
  assert.equal(s.merger.calls.length, 0);
});

test('a failed merge keeps the critiques on disk and says where', async () => {
  const s = seats(2);
  s.list.forEach((a, i) => a.responses.push(CRITIQUE(`seat${i}`)));
  s.merger.responses.push(() => { throw new Error('timed out'); });
  const dir = out();
  await assert.rejects(lib.runPolish(IDEA, { critics: s.critics, merger: s.mergerSeat, outDir: dir }), /could not merge.*polish\.md/);
  assert.match(fs.readFileSync(path.join(dir, 'polish.md'), 'utf8'), /seat0/);
});

test('an empty or oversized idea is refused before any call', async () => {
  const s = seats(1);
  await assert.rejects(lib.runPolish('   ', { critics: s.critics, merger: s.mergerSeat }), /Give the idea/);
  await assert.rejects(lib.runPolish('x'.repeat(lib.MAX_IDEA_CHARS + 1), { critics: s.critics, merger: s.mergerSeat }), /up to 20000/);
  assert.equal(s.list[0].calls.length, 0);
});

test('parseSections tolerates heading markup models vary', () => {
  const text = '### **Polished idea**:\nA\n\n## What Changed\n1. x\n## disagreements\nNone.';
  const s = lib.parseSections(text, lib.SYNTHESIS_SECTIONS);
  assert.equal(s['POLISHED IDEA'], 'A');
  assert.equal(s['WHAT CHANGED'], '1. x');
  assert.equal(s['DISAGREEMENTS'], 'None.');
  assert.equal(s['OPEN QUESTIONS FOR YOU'], '');
});

test('shuffledOrder is a permutation', () => {
  for (let k = 0; k < 20; k++) assert.deepEqual([...lib.shuffledOrder(3)].sort(), [0, 1, 2]);
});

test('council polish --help is registered and names the blind pass', () => {
  const r = spawnSync(process.execPath, [bin, 'polish', '--help'], { encoding: 'utf8', env: { ...process.env, COUNCIL_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /critique it blind/);
  assert.match(r.stdout, /--rebuttal/);
});

test('council polish refuses an unknown critic before running anything', () => {
  const r = spawnSync(process.execPath, [bin, 'polish', '--critics', 'nope', 'an idea'], { encoding: 'utf8', env: { ...process.env, COUNCIL_HOME: home } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unsupported provider 'nope'/);
});
