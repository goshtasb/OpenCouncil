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
const { describeSeatError } = require('../dist/engine/seats.js');
const FAKE_ACP = path.join(__dirname, 'fixtures', 'fake-acp-agent.cjs');

// A real capture of the list agy printed for `--model gemini-3.1-pro-high` (Nov 2026). The line
// before it and agy's exit code were not captured, so the fake prints an arbitrary line before it
// and the tests run both exit codes. agy lists display names, and `agy --model "Gemini 4 Argon (High)"`
// is accepted, so they are valid seat models.
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'agy-model-rejection.txt'), 'utf8');
const REJECTION = (model) => `Some wording agy uses that names ${model} and its settings\n${FIXTURE}`;

/**
 * A stand-in `agy` on PATH: answers "ok <model>" for the models it offers and prints agy's
 * "Available models:" rejection for any other. FAKE_AGY_REJECT_EXIT sets the rejection's exit code.
 * Every --model it is called with is appended to FAKE_AGY_LOG.
 */
function withFakeAgy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fake-agy-'));
  const log = path.join(dir, 'calls.log');
  // `agy acp` runs the scripted ACP agent (test/fixtures/fake-acp-agent.cjs); FAKE_AGY_NO_ACP plays an
  // agy too old to have it. Every other call is the CLI path below.
  const script = `#!/usr/bin/env node
if (process.argv[2] === 'acp') {
  require('fs').appendFileSync(process.env.FAKE_AGY_LOG, 'acp\\n');
  if (process.env.FAKE_AGY_NO_ACP) { console.error("error: unknown command 'acp'"); process.exit(2); }
  require(${JSON.stringify(FAKE_ACP)});
} else {
const args = process.argv.slice(2);
const i = args.indexOf('--model');
const model = i === -1 ? '' : args[i + 1];
require('fs').appendFileSync(process.env.FAKE_AGY_LOG, model + '\\n');
if (process.env.FAKE_AGY_INTERRUPT) { process.stdout.write(${JSON.stringify(`${'A long answer. '.repeat(100)}\n${FIXTURE}`)}); console.error('error: interrupted'); process.exit(1); }
if (!process.env.FAKE_AGY_REJECT_ALL && (model === '${ANTIGRAVITY_DEFAULT_MODEL}' || model === 'gemini-3.8-flash-high')) { console.log('ok ' + model); process.exit(0); }
process.stdout.write(${JSON.stringify(REJECTION('MODEL'))}.replace('MODEL', model));
process.exit(Number(process.env.FAKE_AGY_REJECT_EXIT || 1));
}
`;
  fs.writeFileSync(path.join(dir, 'agy'), script, { mode: 0o755 });
  const saved = {};
  for (const k of ['PATH', 'FAKE_AGY_LOG', 'FAKE_AGY_REJECT_EXIT', 'FAKE_AGY_REJECT_ALL', 'FAKE_AGY_INTERRUPT', 'FAKE_AGY_NO_ACP', 'COUNCIL_RETRY_DELAY_MS',
    'FAKE_ACP_LOG', 'FAKE_ACP_MODELS', 'FAKE_ACP_QUOTA', 'FAKE_ACP_COMMAND']) saved[k] = process.env[k];
  process.env.COUNCIL_RETRY_DELAY_MS = '0';
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_AGY_LOG = log;
  process.env.FAKE_ACP_LOG = path.join(dir, 'acp.log');
  process.env.FAKE_ACP_MODELS = 'gemini-4-argon,gemini-3.8-flash,claude-opus-5-5,gpt-oss-120b-medium';
  const acpLog = () => (fs.existsSync(process.env.FAKE_ACP_LOG) ? fs.readFileSync(process.env.FAKE_ACP_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
  const sets = () => acpLog().filter(e => e.set).map(e => [e.set, e.value]);
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  return Promise.resolve(fn({ dir, calls, acpLog, sets })).finally(() => {
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

test('parseUnavailableModel reads agy\'s real model list, and ignores an answer that only quotes the phrase', () => {
  const models = parseUnavailableModel(REJECTION('gemini-3.1-pro-high'));
  assert.equal(models.length, 13);
  assert.deepEqual(models.slice(0, 2), ['Gemini 4 Argon (Medium)', 'Gemini 4 Argon (High)']);
  assert.equal(models[12], 'GPT-OSS 120B (Medium)');
  assert.deepEqual(parseUnavailableModel(FIXTURE), models, 'the wording before the list does not matter');
  assert.equal(parseUnavailableModel('All good, nothing to see.'), null);
  assert.equal(parseUnavailableModel('It checks for "Available models:" in agy\'s output.'), null);
  assert.equal(parseUnavailableModel(`${FIXTURE}\nSo pick one of those for the seat.`), null, 'an answer that quotes the list and goes on is an answer');
  assert.equal(parseUnavailableModel('Available models:\n'), null, 'the marker with no list is not a rejection');
});

// The model tests below run an exec seat, which keeps agy's CLI path; read-only seats run over ACP.
test('a model agy does not offer fails with the model name and the fix, not the raw dump', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    const adapter = new AntigravityAdapter();
    const err = await adapter.runPrompt('hi', { cwd: dir, permissionMode: 'exec', model: 'gemini-9' }).catch(e => e);
    assert.ok(err instanceof AntigravityModelError, String(err));
    assert.match(err.message, /does not offer the model "gemini-9"/);
    assert.match(err.message, /seats\.lead_pm\.model/);
    assert.match(err.message, /`agy models`/);
    assert.match(err.message, /for example "Gemini 4 Argon \(Medium\)", "Gemini 4 Argon \(High\)"/);
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
      const out = await adapter.runPrompt('hi', { cwd: dir, permissionMode: 'exec', model: 'gemini-3.1-pro-high' });
      assert.equal(out.trim(), `ok ${ANTIGRAVITY_DEFAULT_MODEL}`, `agy exit ${exitCode}`);
      assert.deepEqual(calls(), ['gemini-3.1-pro-high', ANTIGRAVITY_DEFAULT_MODEL]);
    });
  }
});

test('a model agy offers runs as configured', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    const out = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'exec', model: 'gemini-3.8-flash-high' });
    assert.equal(out.trim(), 'ok gemini-3.8-flash-high');
    assert.deepEqual(calls(), ['gemini-3.8-flash-high']);
  });
});

test('the retired model is retried exactly once: if the default is rejected too, that error stands', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    process.env.FAKE_AGY_REJECT_ALL = '1';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'exec', model: 'gemini-3.1-pro-high' }).catch(e => e);
    assert.ok(err instanceof AntigravityModelError, String(err));
    assert.equal(err.model, ANTIGRAVITY_DEFAULT_MODEL);
    assert.deepEqual(calls(), ['gemini-3.1-pro-high', ANTIGRAVITY_DEFAULT_MODEL], 'no third call');
  });
});

test('an interrupted run that quotes "Available models:" stays a transient failure, not a model error', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    process.env.FAKE_AGY_INTERRUPT = '1';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'exec', model: ANTIGRAVITY_DEFAULT_MODEL }).catch(e => e);
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof AntigravityModelError), err.message);
    assert.equal(lib.isTransientFailure(err), true);
    assert.equal(calls().length, 2, 'agy\'s own interrupted retry still runs once');
  });
});

// Issue #46: read-only seats run over `agy acp`, in agy's plan mode, with writes refused.

test('#46: a plan seat runs over agy acp in plan mode, with the CLI model id split into model and thinking level', async () => {
  await withFakeAgy(async ({ dir, calls, sets }) => {
    const out = await new AntigravityAdapter().runPrompt('review it', { cwd: dir, permissionMode: 'plan', model: ANTIGRAVITY_DEFAULT_MODEL, timeoutSeconds: 30 });
    assert.match(out, new RegExp(`^fake answer: Your workspace is exactly the directory`));
    assert.deepEqual(calls(), ['acp'], 'the CLI path (agy -p) is not used');
    assert.deepEqual(sets(), [['mode', 'plan'], ['model', 'gemini-4-argon'], ['thought_level', 'high']]);
  });
});

test('#46: a plan seat refuses agy\'s ask to write, and nothing is written', async () => {
  await withFakeAgy(async ({ dir }) => {
    const out = await new AntigravityAdapter().runPrompt('SCENARIO:write', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 30 });
    assert.equal(out, 'DENIED');
    assert.equal(fs.existsSync(path.join(dir, 'fake-write.txt')), false);
  });
});

test('#46: a plan seat can still list and search the repo, but not run a command that writes', async () => {
  await withFakeAgy(async ({ dir }) => {
    process.env.FAKE_ACP_COMMAND = "find . -type f -not -path './.git/*' | head -200";
    assert.equal(await new AntigravityAdapter().runPrompt('SCENARIO:shell', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 30 }), 'RAN');
    process.env.FAKE_ACP_COMMAND = 'git checkout -- . && rm -rf src';
    assert.equal(await new AntigravityAdapter().runPrompt('SCENARIO:shell', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 30 }), 'DENIED');
  });
});

test('#46: the no-tool seat is refused even a read-only command', async () => {
  await withFakeAgy(async ({ dir, sets }) => {
    process.env.FAKE_ACP_COMMAND = 'ls';
    assert.equal(await new AntigravityAdapter().runPrompt('SCENARIO:shell', { cwd: dir, timeoutSeconds: 30 }), 'DENIED');
    assert.deepEqual(sets()[0], ['mode', 'plan']);
  });
});

test('#46: over ACP, display names map to agy\'s ids, and a model agy does not offer is a model error', async () => {
  await withFakeAgy(async ({ dir, sets }) => {
    await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'plan', model: 'Claude Opus 5.5 (High)', timeoutSeconds: 30 });
    assert.deepEqual(sets().slice(1), [['model', 'claude-opus-5-5'], ['thought_level', 'high']]);
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'plan', model: 'gemini-9', timeoutSeconds: 30 }).catch(e => e);
    assert.ok(err instanceof AntigravityModelError, String(err));
    assert.match(err.message, /does not offer the model "gemini-9"/);
    assert.equal(describeSeatError(err).kind, 'model');
  });
});

test('#46: a plan seat on the retired model is retried once on the default, over ACP', async () => {
  await withFakeAgy(async ({ dir, calls, sets }) => {
    await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'plan', model: 'gemini-3.1-pro-high', timeoutSeconds: 30 });
    assert.deepEqual(calls(), ['acp', 'acp']);
    assert.deepEqual(sets().filter(([id]) => id === 'model'), [['model', 'gemini-4-argon']]);
  });
});

test('agy\'s quota notice is a used-up limit, not the seat\'s answer', async () => {
  await withFakeAgy(async ({ dir }) => {
    process.env.FAKE_ACP_QUOTA = 'gemini-4-argon';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'plan', model: ANTIGRAVITY_DEFAULT_MODEL, timeoutSeconds: 30 }).catch(e => e);
    assert.ok(err instanceof Error, 'it throws');
    assert.equal(describeSeatError(err).kind, 'quota', err.message);
    assert.equal(lib.isTransientFailure(err), false, 'a used-up quota is not retried at once');
  });
});

test('#46: an agy without `agy acp` fails clearly and never falls back to the CLI path', async () => {
  await withFakeAgy(async ({ dir, calls }) => {
    process.env.FAKE_AGY_NO_ACP = '1';
    const err = await new AntigravityAdapter().runPrompt('hi', { cwd: dir, permissionMode: 'plan', timeoutSeconds: 30 }).catch(e => e);
    assert.ok(err instanceof Error);
    assert.match(err.message, /agy acp.*1\.5\.5 or newer/);
    assert.deepEqual(calls(), ['acp'], 'no agy -p call');
  });
});
