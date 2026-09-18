const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'council-test-home-'));
process.env.COUNCIL_HOME = home;

const dist = path.join(__dirname, '..', 'dist');
const lib = require(path.join(dist, 'index.js'));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'council-test-repo-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

/** Scripted seat: `responses` is an array of (prompt, options) => string, consumed in order. */
class ScriptedAdapter {
  constructor(name, responses) {
    this.name = name;
    this.responses = responses;
    this.calls = [];
  }
  async isAvailable() { return true; }
  async runPrompt(prompt, options) {
    this.calls.push({ prompt, options });
    const next = this.responses.shift();
    if (!next) throw new Error(`${this.name}: no scripted response left (call ${this.calls.length})`);
    return typeof next === 'function' ? next(prompt, options) : next;
  }
}

let counter = 0;
function setup({ pm = [], eng = [], arch = [], council = {}, project = {} } = {}) {
  counter++;
  const repo = makeRepo();
  const adapters = {
    pm: new ScriptedAdapter(`fake-pm-${counter}`, pm),
    eng: new ScriptedAdapter(`fake-eng-${counter}`, eng),
    arch: new ScriptedAdapter(`fake-arch-${counter}`, arch)
  };
  for (const a of Object.values(adapters)) lib.registerAdapter(a.name, a);
  const config = JSON.parse(JSON.stringify(lib.DEFAULT_CONFIG));
  config.seats.lead_pm.provider = adapters.pm.name;
  config.seats.chief_engineer.provider = adapters.eng.name;
  config.seats.chief_architect.provider = adapters.arch.name;
  Object.assign(config.council, council);
  Object.assign(config.project, { install_command: '', test_command: 'true', lint_command: '' }, project);
  const stateDir = lib.projectStateDir(repo);
  const sessions = new lib.SessionManager(path.join(stateDir, 'sessions'));
  const pipeline = new lib.PipelineManager(path.join(stateDir, 'backlog'));
  return { repo, adapters, config, sessions, pipeline };
}

const PLAN = (n = 1) => `# Product Brief\nBrief v${n}\n\n# PRD\n1. Requirement v${n}\n\n# Executive Summary\nSummary v${n}\n`;
const SHIP = 'VERDICT: SHIP IT\nOPEN OBJECTIONS: 0\n\nNot checked: nothing.';
const OBJECT = 'VERDICT: SHIP WITH CHANGES\nOPEN OBJECTIONS: 1\n\n1. Missing test (README.md:1). Add a test.';
const SIGNOFF = 'VERDICT: SIGN-OFF\nSUMMARY: Clean.';
const LEAD_OK = 'VERDICT: SIGN-OFF\nSUMMARY: Ready for the Operator.';

function engines(ctx) {
  return {
    council: new lib.CouncilEngine(ctx.config, ctx.sessions, ctx.pipeline),
    deliberation: new lib.DeliberationEngine(ctx.config, ctx.sessions, ctx.pipeline),
    execution: new lib.ExecutionEngine(ctx.config, ctx.sessions, ctx.pipeline)
  };
}

function revision(n) {
  return `# Response to Objections\n1. Adopted: added a test.\n${lib.REVISED_DOCUMENT_MARKER}\n${PLAN(n)}`;
}

async function approvedSession(ctx, slug) {
  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
  ctx.adapters.eng.responses.push(SHIP);
  ctx.adapters.arch.responses.push(SIGNOFF);
  const { council, deliberation } = engines(ctx);
  const item = ctx.pipeline.addItem(slug, 1, '');
  const sid = await council.open(ctx.repo, slug, { backlogItem: item.id });
  const result = await deliberation.run(sid);
  council.approve(sid, result.approvalToken);
  return { sid, item };
}

function fakeGh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-fake-gh-'));
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$1 $2" in\n  "pr view") exit 1;;\n  "pr create") echo https://github.com/example/repo/pull/1;;\nesac\nexit 0\n`, { mode: 0o755 });
  return { dir, log };
}

const commitAndFinish = (prompt, options) => {
  fs.writeFileSync(path.join(options.cwd, 'feature.txt'), 'implemented\n');
  git(options.cwd, 'add', 'feature.txt');
  git(options.cwd, '-c', 'user.email=e@x', '-c', 'user.name=E', 'commit', '-qm', 'feat: implement');
  fs.writeFileSync(path.join(options.cwd, 'DONE.md'), 'done');
  return 'finished';
};

module.exports = { lib, home, git, makeRepo, setup, ScriptedAdapter, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, engines, revision, approvedSession, fakeGh, commitAndFinish };

