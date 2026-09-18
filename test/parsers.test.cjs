const test = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require('./helpers.cjs');

test('engineer reply: markdown-decorated headers parse', () => {
  const v = lib.parseEngineerReply('**VERDICT:** SHIP IT\n**OPEN OBJECTIONS:** 0', 1, 'a', 'b');
  assert.equal(v.verdict, 'SHIP IT');
  assert.equal(v.openObjections, 0);
  assert.equal(v.converged, true);
});

test('engineer reply: SHIP IT with objections does not converge; garbage is UNPARSEABLE', () => {
  assert.equal(lib.parseEngineerReply('VERDICT: SHIP IT\nOPEN OBJECTIONS: 2', 1, 'a', 'b').converged, false);
  const g = lib.parseEngineerReply('looks fine to me', 1, 'a', 'b');
  assert.equal(g.verdict, 'UNPARSEABLE');
  assert.equal(g.converged, false);
});

test('engineer reply: a later quoted VERDICT line does not override the header', () => {
  const v = lib.parseEngineerReply('VERDICT: RETHINK\nOPEN OBJECTIONS: 3\n\n> VERDICT: SHIP IT', 1, 'a', 'b');
  assert.equal(v.verdict, 'RETHINK');
});

test('review: em dash, en dash and spaced hyphen separators all parse', () => {
  for (const sep of ['—', '–', '-']) {
    const r = lib.parseReview(`CONCERN 1: ADVISORY ${sep} SRE ${sep} add retries\nVERDICT: SIGN-OFF WITH CONCERNS\nSUMMARY: ok`, 1, 'p', 'r');
    assert.equal(r.concerns.length, 1, `separator ${sep}`);
    assert.equal(r.concerns[0].principle, 'SRE');
    assert.equal(r.verdict, 'SIGN-OFF WITH CONCERNS');
  }
});

test('review: a REQUIRED concern forces RETHINK even if the stated verdict is SIGN-OFF', () => {
  const r = lib.parseReview('CONCERN 1: REQUIRED — OWASP — secrets in code\nVERDICT: SIGN-OFF', 1, 'p', 'r');
  assert.equal(r.requiredConcerns, 1);
  assert.equal(r.verdict, 'RETHINK');
});

test('review: an unformatted REQUIRED concern still counts', () => {
  const r = lib.parseReview('CONCERN 2: REQUIRED: no rollback plan\nVERDICT: SIGN-OFF', 1, 'p', 'r');
  assert.equal(r.requiredConcerns, 1);
  assert.equal(r.verdict, 'RETHINK');
});

test('tiebreak: hyphen separator is stripped from the reason', () => {
  const t = lib.parseTieBreak('RULING 1: STANDS - principle x\nRULING 2: overruled — y\nSUMMARY: s', 7, 2);
  assert.deepEqual(t.rulings.map(r => [r.id, r.ruling, r.reason]), [[1, 'STANDS', 'principle x'], [2, 'OVERRULED', 'y']]);
  assert.equal(t.summary, 's');
});

test('lead sign-off parsing', () => {
  assert.equal(lib.parseLeadSignoff('**VERDICT: SIGN-OFF**', 1, 'p', 'r').verdict, 'SIGN-OFF');
  assert.equal(lib.parseLeadSignoff('VERDICT: Sign off.', 1, 'p', 'r').verdict, 'SIGN-OFF');
  assert.equal(lib.parseLeadSignoff('VERDICT: RETHINK\n1. change x', 1, 'p', 'r').verdict, 'RETHINK');
  assert.equal(lib.parseLeadSignoff('I approve', 1, 'p', 'r').verdict, 'UNPARSEABLE');
});

test('splitLeadReply separates response notes from the document and strips preamble', () => {
  const { changes, document } = lib.splitLeadReply(`# Response to Objections\n1. adopted\n${lib.REVISED_DOCUMENT_MARKER}\nSure, here it is:\n# Product Brief\nx\n# PRD\ny\n# Executive Summary\nz`);
  assert.match(changes, /adopted/);
  assert.ok(document.startsWith('# Product Brief'));
});

test('markers glued to preceding prose are still parsed (observed from a real Grok reply)', () => {
  const r = lib.parseReview("I'll audit the spec.CONCERN 1: REQUIRED — OWASP — secret in code\nVERDICT: SIGN-OFF WITH CONCERNS", 1, 'p', 'r');
  assert.equal(r.requiredConcerns, 1);
  assert.equal(r.verdict, 'RETHINK');
  const t = lib.parseTieBreak('Ruling follows.RULING 1: OVERRULED — simplicity', 7, 1);
  assert.equal(t.rulingsCount, 1);
  const v = lib.parseEngineerReply('Checked the repo.VERDICT: SHIP IT\nOPEN OBJECTIONS: 0', 1, 'a', 'b');
  assert.equal(v.converged, true);
  assert.equal(lib.parseReview('SIGN-OFF WITH CONCERNS noted\nVERDICT: SIGN-OFF', 1, 'p', 'r').concerns.length, 0);
});

test('a document the seat saved to a file instead of printing is recovered', () => {
  const fsx = require('fs');
  const osx = require('os');
  const pathx = require('path');
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'council-plan-'));
  const saved = pathx.join(dir, 'council-draft-v3.md');
  fsx.writeFileSync(saved, '# Product Brief\nb\n# PRD\np\n# Executive Summary\ns\n');

  // Observed shape: Claude Code in plan mode replies with a summary and the path it saved.
  const reply = `Council Draft v3 is complete and saved to \`${saved}\`.\n\n# Response to Objections\n1. Adopted.`;
  const { changes, document } = lib.splitLeadReply(lib.recoverSavedDocument(reply));
  assert.match(changes, /Response to Objections/);
  assert.ok(document.startsWith('# Product Brief'), 'document recovered from the saved file');

  // A reply that already contains the document is untouched, and a bogus path changes nothing.
  const inline = '# Product Brief\nx\n# PRD\ny\n# Executive Summary\nz\n';
  assert.equal(lib.recoverSavedDocument(inline), inline);
  assert.equal(lib.recoverSavedDocument('saved to /nope/missing.md'), 'saved to /nope/missing.md');
});
