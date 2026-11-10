// A review's verdict comes from the Chief Architect's rulings, not from a PRD sign-off: PASS when nothing that blocks
// is left, CHANGES REQUESTED when an objection stands, needs a measurement or was never ruled on. No model is called.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { lib } = require('./helpers.cjs');

const objections = (...headlines) => [`VERDICT: SHIP WITH CHANGES`, `OPEN OBJECTIONS: ${headlines.length}`, '',
  ...headlines.map((h, i) => `${i + 1}. **${h} (src/a.js:${i + 1}).** Evidence for it.`)].join('\n');
const ruled = (...rulings) => ({ reply: '', rulings: rulings.map((ruling, i) => ({ id: i + 1, ruling, reason: 'r' })) });
const replay = (rounds, status = 'STALLED') => ({ id: 'sess-1', slug: 's', profile: 'quick', baseSha: 'abcdef1234', status, task: 'Review this change before it ships.\n...', rounds, events: [], rulings: [], maxRounds: 3, signoffRevisions: 0 });

test('parseTieBreak reads MINOR as a ruling of its own', () => {
  const t = lib.parseTieBreak('RULING 1: MINOR — naming only\nRULING 2: STANDS — breaks callers\nSUMMARY: s', 1, 2);
  assert.deepEqual(t.rulings.map(r => r.ruling), ['MINOR', 'STANDS']);
});

test('every objection ruled MINOR: the review passes, and the notes are shown as notes, not blockers', () => {
  const r = replay([{ n: 1, engineer: { reply: objections('Rename the helper', 'Tighten the wording'), openObjections: 2 }, tiebreak: ruled('MINOR', 'MINOR') }]);
  const v = lib.reviewVerdict(r);
  assert.equal(v.verdict, 'PASS');
  assert.equal(v.summary, 'no blocking objection; 2 minor notes');
  const top = lib.topObjections(r, 5);
  assert.deepEqual(top.map(o => o.state), ['minor', 'minor']);
  const md = lib.renderReplayMarkdown(r, { top, verdict: v, rounds: false });
  assert.match(md, /^Outcome: \*\*PASS\*\* after 1 round: no blocking objection; 2 minor notes/m);
  assert.match(md, /the Chief Architect ruled it minor: right, but it does not block/);
  assert.match(lib.shareLine(r, top, v), /and it passed with 2 minor notes\. First note, from the Chief Engineer: "Rename the helper/);
});

test('one objection that stands is enough for CHANGES REQUESTED, and it leads the found list ahead of the minor ones', () => {
  const r = replay([{ n: 1, engineer: { reply: objections('Style nit', 'The retry never stops'), openObjections: 2 }, tiebreak: ruled('MINOR', 'STANDS') }]);
  const v = lib.reviewVerdict(r);
  assert.equal(v.verdict, 'CHANGES REQUESTED');
  assert.equal(v.summary, '1 objection stands; 1 minor note');
  const top = lib.topObjections(r, 5);
  assert.match(top[0].headline, /retry never stops/);
  assert.equal(top[0].state, 'blocking');
  assert.match(lib.shareLine(r, top, v), /First objection, from the Chief Engineer, upheld by the Chief Architect: "The retry never stops/);
});

test('objections nobody ruled on block: a missing Chief Architect never turns into a pass', () => {
  const r = replay([{ n: 1, engineer: { reply: objections('Breaks the caller'), openObjections: 1 } }]);
  const v = lib.reviewVerdict(r);
  assert.equal(v.verdict, 'CHANGES REQUESTED');
  assert.equal(v.summary, '1 objection nobody ruled on');
  // An open count with nothing the parser can read behind it still blocks.
  assert.equal(lib.reviewVerdict(replay([{ n: 1, engineer: { reply: 'it is wrong', openObjections: 999 } }])).verdict, 'CHANGES REQUESTED');
});

test('MEASURE blocks until someone measures it', () => {
  const r = replay([{ n: 1, engineer: { reply: objections('The claimed speedup is unproven'), openObjections: 1 }, tiebreak: ruled('MEASURE') }]);
  assert.deepEqual([lib.reviewVerdict(r).verdict, lib.reviewVerdict(r).summary], ['CHANGES REQUESTED', '1 to verify']);
});

test('in a debate, an objection upheld in round 1 still blocks when round 2 argues about something else', () => {
  const r = replay([
    { n: 1, engineer: { reply: objections('The retry never stops'), openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: objections('FR numbering is off'), openObjections: 1 }, tiebreak: ruled('MINOR') }
  ]);
  const v = lib.reviewVerdict(r);
  assert.equal(v.verdict, 'CHANGES REQUESTED');
  assert.equal(v.summary, '1 objection stands; 1 minor note');
  // An objection raised in round 1 that nobody ruled on, and round 2 did not raise again, was withdrawn.
  const dropped = replay([
    { n: 1, engineer: { reply: objections('Unclear claim'), openObjections: 1 } },
    { n: 2, engineer: { reply: objections('FR numbering is off'), openObjections: 1 }, tiebreak: ruled('MINOR') }
  ]);
  assert.equal(lib.reviewVerdict(dropped).verdict, 'PASS');
  assert.equal(lib.topObjections(dropped, 5).find(o => /Unclear/.test(o.headline)).state, 'resolved');
});

test('the Chief Engineer ends with nothing open: advisory concerns alone pass, a REQUIRED one or a RETHINK does not', () => {
  const ship = { reply: 'VERDICT: SHIP IT\nOPEN OBJECTIONS: 0', openObjections: 0 };
  const advisory = replay([{ n: 1, engineer: ship, architect: { reply: '', verdict: 'SIGN-OFF WITH CONCERNS', concerns: [{ type: 'ADVISORY', description: 'Add a changelog line.' }] } }]);
  assert.deepEqual([lib.reviewVerdict(advisory).verdict, lib.reviewVerdict(advisory).summary], ['PASS', 'no blocking objection; 1 minor note']);
  const required = replay([{ n: 1, engineer: ship, architect: { reply: '', verdict: 'SIGN-OFF WITH CONCERNS', concerns: [{ type: 'REQUIRED', description: 'The migration has no rollback.' }] } }]);
  assert.equal(lib.reviewVerdict(required).verdict, 'CHANGES REQUESTED');
  const rethink = replay([{ n: 1, engineer: ship, architect: { reply: '', verdict: 'RETHINK', concerns: [] } }]);
  assert.equal(lib.reviewVerdict(rethink).verdict, 'CHANGES REQUESTED');
  assert.equal(lib.reviewVerdict(replay([{ n: 1, engineer: ship }], 'AWAITING_APPROVAL')).summary, 'every seat signed off');
});

test('the Action turns the two-word verdict into one output value', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');
  const sed = /outcome=\$\(sed -n '([^']+)'/.exec(yml)[1];
  const md = 'Outcome: **CHANGES REQUESTED** after 2 rounds: 1 objection stands (quick profile, base `abc1234`).\n';
  const r = spawnSync('bash', ['-c', `outcome=$(printf %s "$MD" | sed -n '${sed}' | head -n1); outcome=\${outcome// /_}; echo "$outcome"`], { env: { ...process.env, MD: md }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'CHANGES_REQUESTED');
  assert.match(yml, /outcome=\$\{outcome\/\/ \/_\}/);
});

test('login: Claude Code\'s own login lines count wherever it prints them; other words about logins count only on stderr', () => {
  const kind = (e) => lib.describeSeatError(e).kind;
  // Claude Code prints its login failures on stdout.
  assert.equal(kind({ stdout: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.', exitCode: 1 }), 'login');
  // A model's answer on stdout that talks about 401s or logins is not the CLI's own login failing.
  assert.notEqual(kind({ stdout: 'The handler returns 401 unauthorized when the session has expired.', exitCode: 1 }), 'login');
  assert.notEqual(kind({ stdout: 'Users must sign in again after the token expired.', exitCode: 1 }), 'login');
  // On stderr, where no model text goes, they do count.
  assert.equal(kind({ stderr: 'Error: 403 permission denied', exitCode: 1 }), 'login');
  assert.equal(kind({ stderr: 'You are not signed in. Please sign in again.', exitCode: 1 }), 'login');
});

test('an upheld objection blocks even when the Chief Engineer later reports nothing open, or the seats sign off the brief', () => {
  const quiet = replay([
    { n: 1, engineer: { reply: objections('The retry never stops'), openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: 'VERDICT: SHIP IT\nOPEN OBJECTIONS: 0', openObjections: 0 } }
  ]);
  assert.equal(lib.reviewVerdict(quiet).verdict, 'CHANGES REQUESTED');
  assert.equal(lib.reviewVerdict({ ...quiet, status: 'AWAITING_APPROVAL' }).verdict, 'CHANGES REQUESTED');
  // A later ruling never weakens an earlier one: nobody measures or changes the code between a review's rounds.
  const measured = replay([
    { n: 1, engineer: { reply: objections('Speedup unproven'), openObjections: 1 }, tiebreak: ruled('MEASURE') },
    { n: 2, engineer: { reply: objections('Speedup unproven'), openObjections: 1 }, tiebreak: ruled('MINOR') }
  ]);
  assert.deepEqual([lib.reviewVerdict(measured).verdict, lib.reviewVerdict(measured).summary], ['CHANGES REQUESTED', '1 to verify']);
  const upheld = replay([
    { n: 1, engineer: { reply: objections('Missing test'), openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: '1. **Missing test (src/b.js:4).** other', openObjections: 1 }, tiebreak: ruled('MINOR') }
  ]);
  // Same headline, different file:line: two objections, and the earlier STANDS still blocks.
  assert.deepEqual([lib.reviewVerdict(upheld).verdict, lib.reviewVerdict(upheld).stands, lib.reviewVerdict(upheld).minor], ['CHANGES REQUESTED', 1, 1]);
});

test('the same defect restated in a later round, at the same file:line, is counted once', () => {
  const r = replay([
    { n: 1, engineer: { reply: '1. **Retry never stops (src/a.js:9).** x', openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: '1. **The loop at src/a.js:9 still retries 4xx.** x', openObjections: 1 }, tiebreak: ruled('STANDS') }
  ]);
  assert.equal(lib.reviewVerdict(r).stands, 1);
  assert.equal(lib.topObjections(r, 5).length, 1);
});

test('a long model answer on stdout that contains a login line is not a lost login', () => {
  const answer = ['Here is my review.', 'Failed to authenticate. API Error: 401 OAuth access token is invalid.', 'That line is what the CLI prints when the token is wrong.', 'The change handles it.'].join('\n');
  assert.notEqual(lib.describeSeatError({ stdout: answer, exitCode: 1 }).kind, 'login');
  assert.equal(lib.describeSeatError({ stdout: 'Invalid API key · Please run /login', exitCode: 1 }).kind, 'login');
  assert.equal(lib.describeSeatError({ stderr: 'Failed to authenticate', exitCode: 1 }).kind, 'login');
});

test('an upheld ruling on an objection the parser could not read blocks from any round, even after a clean last round', () => {
  const r = replay([
    { n: 1, engineer: { reply: 'The retry never stops; see src/a.js:9.', openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: 'VERDICT: SHIP IT\nOPEN OBJECTIONS: 0', openObjections: 0 } }
  ]);
  assert.deepEqual([lib.reviewVerdict(r).verdict, lib.reviewVerdict(r).stands], ['CHANGES REQUESTED', 1]);
  // With nothing readable to list, the page says why the list is empty instead of "no objections".
  const v = lib.reviewVerdict(r);
  const md = lib.renderReplayMarkdown(r, { top: lib.topObjections(r, 5), verdict: v, rounds: false });
  assert.match(md, /did not pass \(1 objection stands\), but its objections could not be read one by one/);
  assert.doesNotMatch(md, /raised no objections/);
});

test('only the objection list counts: a numbered note past the declared count, or a repeated number, is not another objection', () => {
  const reply = ['VERDICT: SHIP WITH CHANGES', 'OPEN OBJECTIONS: 1', '', '1. **Rename the helper (src/a.js:1).** x', '', 'Notes:', '2. **Good test coverage.** y', '1. **Rename the helper again.** z'].join('\n');
  const r = replay([{ n: 1, engineer: { reply, openObjections: 1 }, tiebreak: ruled('MINOR') }]);
  const v = lib.reviewVerdict(r);
  assert.deepEqual([v.verdict, v.summary], ['PASS', 'no blocking objection; 1 minor note']);
  assert.equal(lib.topObjections(r, 5).length, 1);
});

test('two objections in one round with the same headline stay two, so a MINOR on one never clears a STANDS on the other', () => {
  const reply = ['VERDICT: SHIP WITH CHANGES', 'OPEN OBJECTIONS: 2', '', '1. **Missing test.** for the parser', '2. **Missing test.** for the renderer'].join('\n');
  for (const order of [['STANDS', 'MINOR'], ['MINOR', 'STANDS']]) {
    const r = replay([{ n: 1, engineer: { reply, openObjections: 2 }, tiebreak: ruled(...order) }]);
    const v = lib.reviewVerdict(r);
    assert.deepEqual([v.verdict, v.stands, v.minor], ['CHANGES REQUESTED', 1, 1], order.join(' then '));
  }
});

test('a declared objection the parser could not read still blocks when the others were read and ruled', () => {
  const reply = ['VERDICT: SHIP WITH CHANGES', 'OPEN OBJECTIONS: 2', '', '1. **Rename the helper (src/a.js:1).** x', '', 'Also the retry never stops, see src/a.js:9.'].join('\n');
  const r = replay([{ n: 1, engineer: { reply, openObjections: 2 }, tiebreak: ruled('MINOR') }]);
  const v = lib.reviewVerdict(r);
  assert.deepEqual([v.verdict, v.summary], ['CHANGES REQUESTED', '1 objection nobody ruled on; 1 minor note']);
});

test('two blocking objections at one file:line in the same round are both counted', () => {
  const reply = ['OPEN OBJECTIONS: 2', '', '1. **Retries 4xx (src/a.js:9).** x', '2. **Leaks the timer (src/a.js:9).** y'].join('\n');
  const r = replay([{ n: 1, engineer: { reply, openObjections: 2 }, tiebreak: ruled('STANDS', 'STANDS') }]);
  assert.equal(lib.reviewVerdict(r).stands, 2);
  assert.equal(lib.topObjections(r, 5).length, 2);
});

test('a REQUIRED concern from the Chief Architect is not dropped for matching an overruled objection', () => {
  const r = replay([{ n: 1, engineer: { reply: objections('No rollback for the migration'), openObjections: 1 }, tiebreak: ruled('OVERRULED'),
    architect: { reply: '', verdict: 'SIGN-OFF WITH CONCERNS', concerns: [{ type: 'REQUIRED', description: 'No rollback for the migration (src/a.js:1). It must have one.' }] } }]);
  assert.equal(lib.reviewVerdict(r).verdict, 'CHANGES REQUESTED');
  assert.equal(lib.reviewVerdict(r).required, 1);
});

test('the HTML page shows the verdict: badge, its colour, the summary, and why an empty list is empty', () => {
  const pass = replay([{ n: 1, engineer: { reply: objections('Rename it'), openObjections: 1 }, tiebreak: ruled('MINOR') }]);
  let v = lib.reviewVerdict(pass);
  let html = lib.renderReplayHtml(pass, { top: lib.topObjections(pass, 5), verdict: v });
  assert.match(html, /<span class="outcome ok">Outcome: PASS<\/span>/);
  assert.match(html, /No blocking objection; 1 minor note\./);
  assert.match(html, /the Chief Architect ruled it minor/);
  const blocked = replay([{ n: 1, engineer: { reply: 'It retries forever.', openObjections: 1 }, tiebreak: ruled('STANDS') }]);
  v = lib.reviewVerdict(blocked);
  html = lib.renderReplayHtml(blocked, { top: lib.topObjections(blocked, 5), verdict: v });
  assert.match(html, /<span class="outcome bad">Outcome: CHANGES REQUESTED<\/span>/);
  assert.match(html, /could not be read one by one/);
  assert.doesNotMatch(html, /STALLED/);
  // Without a verdict (any other replay) the page keeps the session status.
  assert.match(lib.renderReplayHtml(blocked, {}), /Outcome: STALLED/);
});

test('Claude\'s "API Error: 401" line on its own is a lost login', () => {
  assert.equal(lib.describeSeatError({ stdout: 'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}', exitCode: 1 }).kind, 'login');
});

test('NO VERDICT: no seat reviewed, the empty list says so, and the Action outputs NO_VERDICT', () => {
  const r = replay([{ n: 1 }]);
  const v = lib.reviewVerdict(r);
  assert.equal(v.verdict, 'NO VERDICT');
  const text = lib.nothingFoundText(r, v);
  assert.match(text, /No seat reviewed the change/);
  assert.doesNotMatch(text, /did not pass|could not be read/);
  const md = lib.renderReplayMarkdown(r, { top: [], verdict: v });
  assert.match(md, /Outcome: \*\*NO VERDICT\*\*/);
  const yml = fs.readFileSync(path.join(__dirname, '..', 'action.yml'), 'utf8');
  const sed = /outcome=\$\(sed -n '([^']+)'/.exec(yml)[1];
  const out = spawnSync('bash', ['-c', `outcome=$(printf %s "$MD" | sed -n '${sed}' | head -n1); outcome=\${outcome// /_}; echo "$outcome"`], { env: { ...process.env, MD: md }, encoding: 'utf8' });
  assert.equal(out.stdout.trim(), 'NO_VERDICT');
});

test('two new objections in a later round at an earlier objection\'s file:line are not both folded into it', () => {
  const at9 = (...hs) => [`VERDICT: SHIP WITH CHANGES`, `OPEN OBJECTIONS: ${hs.length}`, '', ...hs.map((h, i) => `${i + 1}. **${h} (src/a.js:9).** Evidence.`)].join('\n');
  const r = replay([
    { n: 1, engineer: { reply: at9('The retry never stops'), openObjections: 1 }, tiebreak: ruled('STANDS') },
    { n: 2, engineer: { reply: at9('The lock is never released', 'The error is swallowed'), openObjections: 2 }, tiebreak: ruled('STANDS', 'STANDS') }
  ]);
  // One of round 2's may be the round-1 point restated; the other is new either way.
  assert.equal(lib.reviewVerdict(r).stands, 2);
});

test('a severity tag the Chief Engineer puts on its own objection does not show beside the Architect\'s ruling', () => {
  const r = replay([{ n: 1, engineer: { reply: 'OPEN OBJECTIONS: 1\n\n1. **(MINOR) The text is wrong for NO VERDICT (src/a.js:3).** Evidence.', openObjections: 1 }, tiebreak: ruled('STANDS') }]);
  const [top] = lib.topObjections(r, 5);
  assert.match(top.headline, /^The text is wrong/);
  assert.doesNotMatch(top.headline, /MINOR/);
});

test('stderr that mentions OAuth or authentication without a failure is not a lost login', () => {
  assert.equal(lib.describeSeatError({ stderr: 'OAuth token refreshed\nError: connect ECONNRESET', exitCode: 1 }).kind, 'error');
  assert.equal(lib.describeSeatError({ stderr: 'authentication cache warmed\nsegfault', exitCode: 1 }).kind, 'error');
  assert.equal(lib.describeSeatError({ stderr: 'Error: OAuth access token is invalid', exitCode: 1 }).kind, 'login');
  assert.equal(lib.describeSeatError({ stderr: 'Error: authentication failed', exitCode: 1 }).kind, 'login');
});
