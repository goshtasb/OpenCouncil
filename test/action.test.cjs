const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');
const { lib } = require('./helpers.cjs');

const root = path.join(__dirname, '..');
const action = yaml.load(fs.readFileSync(path.join(root, 'action.yml'), 'utf8'));
const step = id => action.runs.steps.find(s => s.id === id || s.name === id);
const fixture = path.join(__dirname, 'fixtures', 'slugify-empty-and-accents');

test('describeAuth names the credential each CLI will use, in its own precedence order', () => {
  assert.equal(lib.describeAuth('claude-code', {}).kind, 'plan');
  assert.match(lib.describeAuth('claude-code', { CLAUDE_CODE_OAUTH_TOKEN: 't' }).label, /Claude plan, through CLAUDE_CODE_OAUTH_TOKEN/);
  const key = lib.describeAuth('claude-code', { ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't' });
  assert.equal(key.kind, 'api-key', 'Claude Code uses ANTHROPIC_API_KEY ahead of the plan token');
  assert.match(key.warning, /bills that key, not your Claude plan/);
  assert.equal(lib.describeAuth('claude-code', { ANTHROPIC_API_KEY: '  ' }).kind, 'plan', 'a blank variable is not a key');
  assert.equal(lib.describeAuth('claude-code', { CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'k' }).kind, 'cloud');
  assert.match(lib.describeAuth('grok-cli', { XAI_API_KEY: 'x' }).label, /XAI_API_KEY/);
  assert.equal(lib.describeAuth('grok-cli', {}).kind, 'plan');
  assert.match(lib.describeAuth('gemini-cli', { GEMINI_API_KEY: 'g' }).label, /GEMINI_API_KEY/);
  assert.match(lib.describeAuth('antigravity', { GEMINI_API_KEY: 'g' }).label, /takes no API key/);
  const logins = lib.describeSeatLogins({ a: { provider: 'claude-code' }, b: { provider: 'claude-code' }, c: { provider: 'grok-cli' } }, { ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(logins.lines, ['Claude Code (2 seats): API key from ANTHROPIC_API_KEY', 'Grok (1 seat): your Grok login']);
  assert.equal(logins.warnings.length, 1);
});

test('planSeats moves the Lead PM from Antigravity to gemini-cli when a Gemini key is set', () => {
  const all = new Set(['claude-code', 'antigravity', 'grok-cli', 'gemini-cli']);
  assert.equal(lib.planSeats(all, {}).seats.lead_pm.provider, 'antigravity', 'no key: Antigravity stays the default');
  const keyed = lib.planSeats(all, { GEMINI_API_KEY: 'g' });
  assert.equal(keyed.mode, 'mixed');
  assert.equal(keyed.seats.lead_pm.provider, 'gemini-cli');
  assert.equal(keyed.seats.chief_architect.provider, 'grok-cli');
  assert.match(keyed.notes.join(' '), /Antigravity cannot use one/);
  assert.equal(lib.planSeats(new Set(['claude-code', 'antigravity']), { GEMINI_API_KEY: 'g' }).seats.lead_pm.provider, 'antigravity', 'without gemini-cli the key changes nothing');
});

test('renderPrComment starts with the marker, leads with the findings, and fits GitHub\'s limit', () => {
  const replay = lib.loadSessionReplay(fixture);
  const top = lib.topObjections(replay);
  const body = lib.renderPrComment(replay, { top, share: lib.shareLine(replay, top), replayUrl: 'https://github.com/o/r/actions/runs/1' });
  assert.ok(body.startsWith(`${lib.PR_COMMENT_MARKER}\n`));
  assert.ok(body.indexOf('What the council found') < body.indexOf('Every round'));
  assert.match(body, /\[The full replay: every round, every seat\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
  const small = lib.renderPrComment(replay, { top, replayUrl: 'https://x.test/run', maxChars: 4000 });
  assert.ok(small.length <= 4000);
  assert.doesNotMatch(small, /Every round/, 'over the limit the rounds are left to the replay');
  assert.match(small, /What the council found/);
  assert.ok(lib.renderPrComment(replay, { top, maxChars: 600 }).length <= 600);
});

function runStep(id, env, extraPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-action-'));
  const out = path.join(dir, 'out');
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(out, '');
  fs.writeFileSync(summary, '');
  const r = spawnSync('bash', ['-e', '-c', step(id).run], {
    encoding: 'utf8',
    env: { ...process.env, ...env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH }
  });
  return { ...r, outputs: Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split('='))), summary: fs.readFileSync(summary, 'utf8') };
}

test('the action skips forks, drafts, other events and a missing login, and runs otherwise', () => {
  const base = { EVENT: 'pull_request', HEAD_REPO: 'o/r', BASE_REPO: 'o/r', DRAFT: 'false', HAS_TOKEN: 'true', HAS_KEY: 'false' };
  const ok = runStep('guard', base);
  assert.equal(ok.status, 0);
  assert.equal(ok.outputs.run, 'true');
  const fork = runStep('guard', { ...base, HEAD_REPO: 'someone/r' });
  assert.equal(fork.status, 0, 'a skip never fails the check');
  assert.equal(fork.outputs.run, 'false');
  assert.match(fork.stdout, /forks get no secrets/);
  assert.equal(runStep('guard', { ...base, DRAFT: 'true' }).outputs.run, 'false');
  assert.equal(runStep('guard', { ...base, EVENT: 'push' }).outputs.run, 'false');
  const none = runStep('guard', { ...base, HAS_TOKEN: 'false' });
  assert.equal(none.outputs.run, 'false');
  assert.match(none.stdout, /::warning title=Open Council::No Claude login/);
  assert.equal(runStep('guard', { ...base, HAS_TOKEN: 'false', HAS_KEY: 'true' }).outputs.run, 'true', 'an API key alone is enough');
});

test('the action edits its own earlier comment instead of adding another', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fake-gh-'));
  const log = path.join(bin, 'calls');
  // Lists one comment with the marker (id 42) when EXISTING is set, then records every call.
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in *--paginate*) [ -n "$EXISTING" ] && echo 42 ;; *) echo https://github.com/o/r/pull/1#issuecomment-42 ;; esac\n`, { mode: 0o755 });
  const body = path.join(bin, 'comment.md');
  fs.writeFileSync(body, `${lib.PR_COMMENT_MARKER}\nhi\n`);
  const env = { GH_TOKEN: 't', REPO: 'o/r', PR: '7', BODY_FILE: body };
  const created = runStep('Post or update the comment', env, bin);
  assert.equal(created.status, 0, created.stderr);
  assert.match(fs.readFileSync(log, 'utf8'), /--method POST repos\/o\/r\/issues\/7\/comments -F body=@/);
  fs.writeFileSync(log, '');
  assert.equal(runStep('Post or update the comment', { ...env, EXISTING: '1' }, bin).status, 0);
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /--method PATCH repos\/o\/r\/issues\/comments\/42/);
  assert.doesNotMatch(calls, /POST/);
});

test('this repo reviews its own pull requests on the maintainer\'s plan token only', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', 'council-review.yml'), 'utf8'));
  assert.deepEqual(wf.on.pull_request.types, ['opened', 'reopened', 'ready_for_review', 'labeled']);
  assert.equal(wf.permissions['pull-requests'], 'write');
  const uses = wf.jobs.review.steps.find(s => s.uses === './');
  assert.deepEqual(Object.keys(uses.with), ['claude_code_oauth_token']);
  assert.ok(action.inputs.claude_code_oauth_token && action.inputs.anthropic_api_key, 'the action itself takes either login');
});

test('a failed seat CLI is reported by name and its last lines, not its whole command line', () => {
  const { briefError } = require('../dist/commands/shared.js');
  const err = Object.assign(new Error('Command failed with exit code 1: claude -p ' + 'persona '.repeat(200)), {
    command: 'claude -p ' + 'persona '.repeat(200), exitCode: 1, stderr: '', stdout: 'Failed to authenticate. API Error: 401 OAuth access token is invalid.'
  });
  assert.equal(briefError(err), 'claude exited with code 1:\nFailed to authenticate. API Error: 401 OAuth access token is invalid.');
  assert.equal(briefError(new Error('plain')), 'plain');
  assert.match(step('review').run, /rejected the login/);
});
