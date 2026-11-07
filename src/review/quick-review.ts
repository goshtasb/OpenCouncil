import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CouncilConfig } from '../types.js';
import { DEFAULT_CONFIG, findConfigFile, loadConfig } from '../config.js';
import { PROVIDER_FIXES, SeatsPlan, detectProviders, planSeats } from '../setup.js';
import { SessionReplay, TopObjection, loadSessionReplay, objectionHeadlines } from '../replay/session-replay.js';
import { renderReplayHtml } from '../replay/html.js';
import { renderReplayMarkdown } from '../replay/markdown-replay.js';
import { SessionManager } from '../engine/session.js';
import { PipelineManager } from '../engine/pipeline.js';
import { CouncilEngine } from '../engine/council.js';
import { DeliberationEngine } from '../engine/deliberation.js';
import { projectStateDir } from '../utils/paths.js';

/** Round budget for `council review`. The first round carries the code objections; later rounds argue over the Lead PM's fix plan, so two keeps a review near four minutes. */
export const REVIEW_ROUNDS = 2;
export const REVIEW_MIN_ROUNDS = 2;
export const REVIEW_MAX_ROUNDS = 4;
/** Above this the diff is too big to argue about usefully in one sitting. */
export const MAX_REVIEW_DIFF_BYTES = 120_000;
/** Untracked files that look like secrets are never sent to a seat. */
export const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i;

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || '' };
}

export interface DetectedGates { install: string; test: string; lint: string; source: string }

/** Works out how the project installs and tests itself from the files at its root. Nothing is run. */
export function detectGates(repo: string): DetectedGates {
  const has = (f: string) => fs.existsSync(path.join(repo, f));
  if (has('package.json')) {
    let scripts: Record<string, string> = {};
    try { scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts || {}; } catch { /* unreadable package.json: no scripts */ }
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
    const install = pm === 'npm' ? (has('package-lock.json') ? 'npm ci' : 'npm install') : `${pm} install`;
    const run = (s: string) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
    const test = scripts.test && !/no test specified/.test(scripts.test) ? (pm === 'npm' ? 'npm test' : `${pm} test`) : '';
    return { install, test, lint: scripts.lint ? run('lint') : '', source: 'package.json' };
  }
  if (has('Cargo.toml')) return { install: '', test: 'cargo test', lint: 'cargo clippy -- -D warnings', source: 'Cargo.toml' };
  if (has('go.mod')) return { install: 'go mod download', test: 'go test ./...', lint: 'go vet ./...', source: 'go.mod' };
  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
    const install = has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install -e .';
    return { install, test: 'python -m pytest', lint: '', source: has('pyproject.toml') ? 'pyproject.toml' : has('setup.py') ? 'setup.py' : 'requirements.txt' };
  }
  return { install: '', test: '', lint: '', source: 'nothing recognised' };
}

/**
 * The config a review runs with. A project's own .council/config.yml is used when it exists; otherwise the
 * seats come from the provider CLIs on PATH and the gates from the project files, and nothing is written.
 * Either way the round budget is cut to `rounds` so a review finishes in minutes.
 */
export async function reviewConfig(repo: string, rounds = REVIEW_ROUNDS, found?: Set<string>): Promise<{ config: CouncilConfig; plan: SeatsPlan | null; gates: DetectedGates | null }> {
  let config: CouncilConfig;
  let plan: SeatsPlan | null = null;
  let gates: DetectedGates | null = null;
  if (findConfigFile(repo)) {
    config = loadConfig(repo);
  } else {
    plan = planSeats(found || await detectProviders());
    if (plan.mode === 'none') {
      throw new Error(`No AI CLI was found on PATH. A review needs at least Claude Code: ${PROVIDER_FIXES['claude-code'].install}, then run \`claude\` once to sign in.`);
    }
    gates = detectGates(repo);
    const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CouncilConfig;
    for (const seat of Object.keys(plan.seats) as (keyof CouncilConfig['seats'])[]) {
      base.seats[seat] = { ...base.seats[seat], provider: plan.seats[seat].provider, model: plan.seats[seat].model };
    }
    base.project = { ...base.project, install_command: gates.install, test_command: gates.test, lint_command: gates.lint };
    config = base;
  }
  if (!Number.isInteger(rounds) || rounds < REVIEW_MIN_ROUNDS || rounds > REVIEW_MAX_ROUNDS) {
    throw new Error(`--rounds takes a whole number from ${REVIEW_MIN_ROUNDS} to ${REVIEW_MAX_ROUNDS} (the quick profile's limit).`);
  }
  const max = rounds;
  config.council = {
    ...config.council,
    profile: 'quick',
    max_rounds: max,
    tiebreak_round: Math.max(1, max - 1),
    signoff_revisions: 1,
    round_timeout_seconds: Math.min(config.council.round_timeout_seconds || 600, 600)
  };
  return { config, plan, gates };
}

export interface ReviewChange { kind: 'uncommitted' | 'branch'; diff: string; base: string; files: string[]; withheld: string[] }

function defaultBase(repo: string): string | null {
  const head = git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const candidates = [head.ok ? head.out.trim() : '', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
  for (const ref of candidates) if (git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
  return null;
}

/**
 * The change to review: uncommitted work if there is any (tracked edits plus new untracked files),
 * otherwise this branch's commits since it left the base branch. Returns null when there is nothing.
 */
const tooBig = (bytes: number, files: number) =>
  `The change is ${Math.round(bytes / 1024)} KB across ${files} file${files === 1 ? '' : 's'}, more than one review can argue about well (${MAX_REVIEW_DIFF_BYTES / 1000} KB). Commit part of it and review the rest, or pass --base with a closer ref.`;

export function collectChange(repo: string, base?: string): ReviewChange | null {
  if (!base) {
    const tracked = git(repo, ['diff', 'HEAD', '--no-color']).out;
    const others = git(repo, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
    const withheld = others.filter(f => SECRET_FILE.test(f));
    const untracked = others.filter(f => !SECRET_FILE.test(f));
    let size = Buffer.byteLength(tracked);
    for (const file of untracked) {
      try { size += fs.statSync(path.join(repo, file)).size; } catch { /* vanished: skipped below */ }
    }
    if (size > MAX_REVIEW_DIFF_BYTES) throw new Error(tooBig(size, untracked.length + (tracked ? 1 : 0)));
    let extra = '';
    for (const file of untracked) {
      const r = spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      extra += r.stdout || '';
    }
    const diff = tracked + extra;
    if (diff.trim()) {
      const files = git(repo, ['diff', 'HEAD', '--name-only']).out.split('\n').filter(Boolean).concat(untracked);
      return { kind: 'uncommitted', diff, base: 'HEAD', files, withheld };
    }
  }
  const ref = base || defaultBase(repo);
  if (!ref) return null;
  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) throw new Error(`Unknown base '${ref}'.`);
  const diff = git(repo, ['diff', '--no-color', `${ref}...HEAD`]).out;
  if (!diff.trim()) return null;
  const files = git(repo, ['diff', '--name-only', `${ref}...HEAD`]).out.split('\n').filter(Boolean);
  return { kind: 'branch', diff, base: ref, files, withheld: [] };
}

/** The task a change review gives the council. The diff is quoted whole; the seats read the repository for the rest. */
export function changeReviewTask(change: ReviewChange): string {
  const checkout = change.kind === 'uncommitted'
    ? 'Your checkout is the last commit, before this change: the diff below is not applied to it.'
    : `Your checkout is this branch with the change applied; it is the diff from ${change.base}.`;
  return [
    'Review this change before it ships.',
    'Lead PM: write the brief and PRD that this change implies: what it is for, what it claims to do, and how we would know it works. Do not invent scope the diff does not show.',
    'Chief Engineer: check every claim against the repository and the diff. Object, with file:line, wherever the change is wrong, incomplete, untested, or breaks something that depends on it.',
    'Chief Architect: rule on whether it should ship as is.',
    '',
    checkout,
    `Files changed (${change.files.length}): ${change.files.join(', ')}`,
    '',
    '```diff',
    change.diff.trimEnd(),
    '```'
  ].join('\n');
}

/** A short session slug from the task or the branch. */
export function reviewSlug(repo: string, task?: string): string {
  const source = task || `review-${git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim() || 'change'}`;
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-');
  return (task ? `review-${slug}` : slug).slice(0, 48).replace(/-+$/, '') || 'review';
}



/** Numbered objections with a bold headline; failing that, plain numbered items whose first sentence is the headline. */
function engineerObjections(reply: string): { headline: string; evidence: string }[] {
  const bold = objectionHeadlines(reply);
  if (bold.length) return bold;
  const out: { headline: string; evidence: string }[] = [];
  for (const line of reply.split('\n')) {
    const m = /^\d+\.\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const headline = m[1].split(/(?<=[.!?])\s/)[0];
    out.push({ headline, evidence: m[1] });
  }
  return out;
}

const LOCATION = /\b[\w./-]+\.[A-Za-z]{1,5}:\d+(?:-\d+)?\b/;

/**
 * The objections worth leading with: the Chief Engineer's, earliest round first (later rounds argue over the fix plan),
 * those that cite a file:line ahead of those that don't, then the Chief Architect's required concerns. Duplicates across rounds are dropped.
 */
export function topObjections(replay: SessionReplay, limit = 3): TopObjection[] {
  const all: TopObjection[] = [];
  for (const round of replay.rounds) {
    if (round.engineer && (round.engineer.openObjections ?? 1) > 0) {
      for (const o of engineerObjections(round.engineer.reply)) {
        const where = LOCATION.exec(`${o.headline} ${o.evidence}`);
        all.push({ round: round.n, seat: 'Chief Engineer', headline: o.headline, evidence: o.evidence, location: where?.[0] });
      }
    }
    if (round.architect) {
      for (const c of round.architect.concerns.filter(c => /REQUIRED/i.test(c.type))) {
        const where = LOCATION.exec(c.description);
        all.push({ round: round.n, seat: 'Chief Architect', headline: c.description.split(/(?<=\.)\s/)[0], evidence: c.description, location: where?.[0] });
      }
    }
  }
  const seen = new Set<string>();
  const unique = all.filter(o => {
    const key = o.headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Headlines that lean on the session's own labels ("ruling R2", "FR7") mean little to anyone outside it.
  const jargon = (o: TopObjection) => (/\b(N?FR|R)\d+\b|\bruling\b/i.test(o.headline) ? 5 : 0);
  const rank = (o: TopObjection) => (o.seat === 'Chief Engineer' ? 0 : 100) + (o.location ? 0 : 10) + jargon(o) + o.round * 8;
  return unique.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).slice(0, limit).map(x => x.o);
}

const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();

/** One line someone can paste anywhere: what the council found, in its own words, and how to run one. */
export function shareLine(replay: SessionReplay, top: TopObjection[]): string {
  const count = top.length;
  if (!count) {
    return `Three AI seats reviewed my ${/^Review this change before it ships\./.test(replay.task) ? 'change' : 'plan'} and found nothing to object to. Try it on yours: npx open-council-cli review`;
  }
  const first = clean(top[0].headline).replace(/[.:;]+$/, '');
  const where = top[0].location ? ` (${top[0].location})` : '';
  const what = /^Review this change before it ships\./.test(replay.task) ? 'my change before shipping it' : 'my plan before building it';
  return `I had three AI seats argue over ${what}. First objection, from the ${top[0].seat}: "${first}"${where}. Try it on yours: npx open-council-cli review`;
}

export interface ReviewOptions {
  task?: string;
  base?: string;
  rounds?: number;
  /** Overrides for tests: a ready config and the managers the engines use. */
  config?: CouncilConfig;
  sessions?: SessionManager;
  pipeline?: PipelineManager;
  onSession?: (sessionId: string, mode: 'task' | ReviewChange['kind'], change: ReviewChange | null) => void;
}

export interface ReviewResult {
  sessionId: string;
  outcome: 'AWAITING_APPROVAL' | 'STALLED';
  rounds: number;
  seconds: number;
  replay: SessionReplay;
  top: TopObjection[];
  share: string;
  htmlPath: string;
  mdPath: string;
}

function removeWorktree(repo: string, worktreePath: string): void {
  git(repo, ['worktree', 'remove', '--force', worktreePath]);
  fs.rmSync(worktreePath, { recursive: true, force: true });
  git(repo, ['worktree', 'prune']);
}

/**
 * One review: open a session on the change (or the one-line task), let the council argue it out, and write the
 * replay as HTML and Markdown into the session directory. Nothing in the repository is written or executed;
 * the seats read it in the harness's own worktree.
 */
export async function runReview(repo: string, options: ReviewOptions = {}): Promise<ReviewResult> {
  const started = Date.now();
  let change: ReviewChange | null = null;
  let task = options.task && options.task.trim();
  if (!task) {
    change = collectChange(repo, options.base);
    if (!change) {
      throw new Error('Nothing to review: no uncommitted changes and no commits ahead of the base branch. Pass a task instead: council review "add rate limiting to the login route"');
    }
    if (Buffer.byteLength(change.diff) > MAX_REVIEW_DIFF_BYTES) throw new Error(tooBig(Buffer.byteLength(change.diff), change.files.length));
    task = changeReviewTask(change);
  }
  const config = options.config || (await reviewConfig(repo, options.rounds)).config;
  const sessions = options.sessions || new SessionManager();
  const council = new CouncilEngine(config, sessions, options.pipeline);
  // A worktree of its own, so a review never resets the one a running session reads, and nothing stays registered after.
  const worktreePath = path.join(projectStateDir(path.resolve(repo)), 'review-worktrees', `${Date.now()}-${process.pid}`);
  let result: Awaited<ReturnType<DeliberationEngine['run']>>;
  let sessionId: string;
  try {
    sessionId = await council.open(repo, reviewSlug(repo, options.task), { task, profile: 'quick', worktreePath });
    options.onSession?.(sessionId, change ? change.kind : 'task', change);
    result = await new DeliberationEngine(config, sessions, options.pipeline).run(sessionId);
  } finally {
    removeWorktree(repo, worktreePath);
  }
  const dir = sessions.getSessionPath(sessionId);
  const replay = loadSessionReplay(dir);
  const top = topObjections(replay, 5);
  const share = shareLine(replay, top);
  const htmlPath = path.join(dir, 'review.html');
  const mdPath = path.join(dir, 'review.md');
  fs.writeFileSync(htmlPath, renderReplayHtml(replay, { top, share }), 'utf8');
  fs.writeFileSync(mdPath, renderReplayMarkdown(replay, { top, share }), 'utf8');
  return { sessionId, outcome: result.outcome, rounds: result.rounds, seconds: Math.round((Date.now() - started) / 1000), replay, top, share, htmlPath, mdPath };
}
