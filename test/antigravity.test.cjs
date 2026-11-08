const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { lib } = require('./helpers.cjs');
const {
  AntigravityAdapter, AntigravityModelError, ANTIGRAVITY_DEFAULT_MODEL, parseUnavailableModel
} = require('../dist/adapters/antigravity.js');
const { doctorFix } = require('../dist/commands/project.js');

// agy lists display names; Ashkan confirmed `agy --model "Gemini 4 Argon (High)"` is accepted, so they are valid seat models.
const REJECTION = (model) => `Error: model "${model}" is not available.\nAvailable models:\n  Gemini 4 Argon (Low)\n  Gemini 4 Argon (High)\n  Gemini 3.8 Flash (High)\n  Claude Opus 5.5\n`;

/**
 * A stand-in `agy` on PATH: answers "ok <model>" for the models it offers and prints agy's
 * "Available models:" rejection for any other. FAKE_AGY_REJECT_EXIT sets the rejection's exit code.
 * Every --model it is called with is appended to FAKE_AGY_LOG.
 */
function withFakeAgy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fake-agy-'));
  const log = path.join(dir, 'calls.log');
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
const i = args.indexOf('--model');
const model = i === -1 ? '' : args[i + 1];
require('fs').appendFileSync(process.env.FAKE_AGY_LOG, model + '\\n');
if (process.env.FAKE_AGY_INTERRUPT) { process.stdout.write(${JSON.stringify(`${'A long answer. '.repeat(100)}
It quotes "Available models:" here.
`)}); console.error('error: interrupted'); process.exit(1); }
if (!process.env.FAKE_AGY_REJECT_ALL && (model === '${ANTIGRAVITY_DEFAULT_MODEL}' || model === 'gemini-3.8-flash-high')) { console.log('ok ' + model); process.exit(0); }
process.stdout.write(${JSON.stringify(REJECTION('MODEL'))}.replace('MODEL', model));
process.exit(Number(process.env.FAKE_AGY_REJECT_EXIT || 1));
`;
  fs.writeFileSync(path.join(dir, 'agy'), script, { mode: 0o755 });
  const saved = {};
  for (const k of ['PATH', 'FAKE_AGY_LOG', 'FAKE_AGY_REJECT_EXIT', 'FAKE_AGY_REJECT_ALL', 'FAKE_AGY_INTERRUPT', 'COUNCIL_RETRY_DELAY_MS']) saved[k] = process.env[k];
  process.env.COUNCIL_RETRY_DELAY_MS = '0';
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_AGY_LOG = log;
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return Promise.resolve(fn({ dir, calls })).finally(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
}

test('the Antigravity default is a model current agy offers, everywhere it is written', () => {
  assert.equal(ANTIGRAVITY_DEFAULT_MODEL, 'gemini-4-argon-high');
  assert.equal(lib.DEFAULT_MODELS.antigravity, ANTIGRAVITY_DEFAULT_MODEL);
  assert.equal(lib.DEFAULT_CONFIG.seats.lead_pm.model, ANTIGRAVITY_DEFAULT_MODEL);
  const template = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'templates', '.council', 'config.yml'), 'utf8'));
  assert.equal(template.seats.lead_pm.provider, 'antigravity');
  assert.equal(template.seats.lead_pm.model, ANTIGRAVITY_DEFAULT_MODEL);
  for (const file of ['README.md', path.join('templates', '.council', 'config.yml'), path.join('.github', 'ISSUE_TEMPLATE', 'council-went-wrong.md')]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /gemini-3\.1-pro-high/, `${file} still names the retired model`);
  }
});

test('parseUnavailableModel reads agy\'s model list, and ignores an answer that only quotes the phrase', () => {
  assert.deepEqual(parseUnavailableModel(REJECTION('gemini-9')), ['Gemini 4 Argon (Low)', 'Gemini 4 Argon (High)', 'Gemini 3.8 Flash (High)', 'Claude Opus 5.5']);
  assert.equal(parseUnavailableModel('All good, nothing to see.'), null);
  assert.deepEqual(parseUnavailableModel(REJECTION('gemini-9'), 'gemini-9').length, 4);
  const answer = `${'The adapter looks fine. '.repeat(40)}\nIt checks for "Available models:" in agy's output.`;
  assert.equal(parseUnavailableModel(answer, 'gemini-9'), null, 'a long answer that quotes the marker is an answer');
});

test('a model agy does not offer fails with the model name and the fix, not the raw dump', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    const adapter = new AntigravityAdapter();
    const err = await adapter.runPrompt('hi', { cwd: dir, model: 'gemini-9' }).catch(e => e);
    assert.ok(err instanceof AntigravityModelError, String(err));
    assert.match(err.message, /does not offer the model "gemini-9"/);
    assert.match(err.message, /seats\.lead_pm\.model/);
    assert.match(err.message, /`agy models`/);
    assert.match(err.message, /"Gemini 4 Argon \(High\)"/);
    assert.equal(lib.isTransientFailure(err), false, 'a missing model is not retried as transient');
    assert.equal(doctorFix('antigravity', err).command, 'agy models', 'doctor points at the model list');
    assert.deepEqual(calls(), ['gemini-9'], 'an unknown model is not swapped for another');
  });
});

test('a seat still on the retired gemini-3.1-pro-high is retried once on the new default', async () => {
  for (const exitCode of ['1', '0']) {
    await withFakeAgy(async ({ dir, calls }) => {
      process.env.FAKE_AGY_REJECT_EXIT = exitCode;
      const adapter = new AntigravityAdapter();
      const out = await adapter.runPrompt('hi', { cwd: dir, model: 'gemini-3.1-pro-high' });
      assert.equal(out.trim(), `ok ${ANTIGRAVITY_DEFAULT_MODEL}`, `agy exit ${exitCode}`);
      assert.deepEqual(calls(), ['gemini-3.1-pro-high', ANTIGRAVITY_DEFAULT_MODEL]);
    });
  }
});

test('a model agy offers runs as configured', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    const out = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, model: 'gemini-3.8-flash-high' });
    assert.equal(out.trim(), 'ok gemini-3.8-flash-high');
    assert.deepEqual(calls(), ['gemini-3.8-flash-high']);
  });
});

test('the retired model is retried exactly once: if the default is rejected too, that error stands', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    process.env.FAKE_AGY_REJECT_ALL = '1';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, model: 'gemini-3.1-pro-high' }).catch(e => e);
    assert.ok(err instanceof AntigravityModelError, String(err));
    assert.equal(err.model, ANTIGRAVITY_DEFAULT_MODEL);
    assert.deepEqual(calls(), ['gemini-3.1-pro-high', ANTIGRAVITY_DEFAULT_MODEL], 'no third call');
  });
});

test('an interrupted run that quotes "Available models:" stays a transient failure, not a model error', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    process.env.FAKE_AGY_INTERRUPT = '1';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, model: ANTIGRAVITY_DEFAULT_MODEL }).catch(e => e);
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof AntigravityModelError), err.message);
    assert.equal(lib.isTransientFailure(err), true);
    assert.equal(calls().length, 2, 'agy\'s own interrupted retry still runs once');
  });
});
