import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CouncilConfig } from '../types.js';
import { DEFAULT_CONFIG, findConfigFile, loadConfig } from '../config.js';
import { PROVIDER_FIXES, SeatsPlan, detectProviders, planSeats } from '../setup.js';
import { ReviewVerdict, SessionReplay, TopObjection, loadSessionReplay, objectionHeadlines } from '../replay/session-replay.js';
import { renderReplayHtml } from '../replay/html.js';
import { allOverruled, renderReplayMarkdown } from '../replay/markdown-replay.js';
import { SessionManager } from '../engine/session.js';
import { PipelineManager } from '../engine/pipeline.js';
import { CouncilEngine } from '../engine/council.js';
import { DeliberationEngine } from '../engine/deliberation.js';
import { projectStateDir } from '../utils/paths.js';
import { REVIEW_TASK_CLAIMS_LINE } from '../engine/claims.js';
import { SEAT_LABELS, answeredVendors, joinNames, providerLabel, vendorOf } from '../engine/seats.js';
import { SeatName } from '../utils/prompts.js';
import { extractArchitectQuestions } from '../engine/questions.js';
import { FAILOVER_ORDER } from './preflight.js';

/**
 * Round budget for `council review`. The default is the quick review: one round, in which the Lead PM states what the
 * change claims, the Chief Engineer objects with file:line, and the Chief Architect rules on each objection. That is one
 * call per seat. `--debate` (or `--rounds 2` to 4) lets the Lead answer the objections and the seats argue on.
 */
export const REVIEW_ROUNDS = 1;
export const REVIEW_DEBATE_ROUNDS = 2;
export const REVIEW_MIN_ROUNDS = 1;
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
 * `found` is the set of providers that can hold a seat: the ones the setup check found ready, or, without a check,
 * every one installed. The diff only ever goes to vendors the user can see on the Seats line: with a config file, the
 * providers its seats name (or its council.failover_providers); without one, the providers the plan seats. A
 * configured seat whose provider is not ready moves to another of those, and says so in `notes`. A seat that fails
 * mid-review moves the same way (council.seat_failover).
 * Either way the round budget is cut to `rounds` so a review finishes in minutes.
 */
export async function reviewConfig(repo: string, rounds = REVIEW_ROUNDS, found?: Set<string>): Promise<{ config: CouncilConfig; plan: SeatsPlan | null; gates: DetectedGates | null; notes: string[] }> {
  let config: CouncilConfig;
  let plan: SeatsPlan | null = null;
  let gates: DetectedGates | null = null;
  const notes: string[] = [];
  const available: Set<string> = found || await detectProviders();
  // The providers this review may send the change to. Failover never reaches past them.
  let allowed: Set<string>;
  let order: string[] = FAILOVER_ORDER;
  if (findConfigFile(repo)) {
    config = JSON.parse(JSON.stringify(loadConfig(repo))) as CouncilConfig;
    // The seats' own AIs, plus any listed under council.failover_providers (which come first, in their order).
    const listed = config.council.failover_providers || [];
    const named = [...new Set([...listed, ...Object.values(config.seats).map(s => s.provider)])];
    if (listed.length) order = [...listed, ...FAILOVER_ORDER.filter(p => !listed.includes(p))];
    allowed = new Set([...available].filter(p => named.includes(p)));
    if (found) {
      if (allowed.size === 0) throw new Error(`None of the AIs .council/config.yml names (${joinNames([...new Set(named)].map(providerLabel))}) is ready. Run the fix printed for one of them, or list other ready ones under council.failover_providers.`);
      const fallback = planSeats(allowed);
      for (const seat of Object.keys(config.seats) as (keyof CouncilConfig['seats'])[]) {
        const configured = config.seats[seat];
        if (available.has(configured.provider)) continue;
        const next = fallback.seats[seat];
        if (fallback.mode === 'none' || !allowed.has(next.provider)) {
          notes.push(`${SEAT_LABELS[seat]}: ${providerLabel(configured.provider)} is not ready, and no other AI that .council/config.yml names can hold the seat${seat === 'chief_architect' ? ' with its tools off' : ''}, so this review runs without it. Fix ${providerLabel(configured.provider)}, or list another ready AI under council.failover_providers.`);
          continue;
        }
        notes.push(`${SEAT_LABELS[seat]}: ${providerLabel(configured.provider)} is not ready, so ${providerLabel(next.provider)} (${next.model}) takes the seat for this review. .council/config.yml is unchanged.`);
        config.seats[seat] = { ...configured, provider: next.provider, model: next.model };
      }
    }
  } else {
    plan = planSeats(available);
    if (plan.mode === 'none') throw new Error(noSeatMessage());
    allowed = new Set(Object.values(plan.seats).map(s => s.provider).filter(p => available.has(p)));
    for (const seat of Object.keys(plan.seats) as (keyof CouncilConfig['seats'])[]) {
      if (!available.has(plan.seats[seat].provider)) notes.push(`No ready AI can hold the ${SEAT_LABELS[seat]} seat${seat === 'chief_architect' ? ' with its tools off' : ''}, so this review runs without it. Claude Code or Grok can hold it.`);
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
  const quick = max === 1;
  config.council = {
    ...config.council,
    profile: 'quick',
    max_rounds: max,
    tiebreak_round: Math.max(1, max - 1),
    // One round means one call per seat: no revision rounds after a sign-off review.
    signoff_revisions: quick ? 0 : 1,
    // Every review ends on the Architect's rulings, so its verdict rests on them and not on a PRD sign-off.
    final_arbitration: true,
    seat_failover: true,
    failover_providers: order.filter(p => allowed.has(p)),
    round_timeout_seconds: Math.min(config.council.round_timeout_seconds || 600, 600)
  };
  return { config, plan, gates, notes };
}

function noSeatMessage(): string {
  return `No AI CLI is ready to hold a seat. A review needs at least Claude Code: ${PROVIDER_FIXES['claude-code'].install}, then \`${PROVIDER_FIXES['claude-code'].login}\`. \`council doctor\` checks every seat and prints the fix for each.`;
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
    'Chief Engineer: check every claim against the repository and the diff. Object, with file:line, to defects in the change and in the code it touches: wrong behaviour, a broken caller, a security or data-loss risk, a changed behaviour with no test. The Lead PM\'s brief only restates the change, so do not object to its wording, numbering or test plan. Say so when an objection is minor (naming, style, a nice-to-have).',
    'Chief Architect: rule on each open objection. STANDS only for a defect that should block shipping, MINOR for one that is right but should not block, OVERRULED for one that is wrong. The review passes when nothing blocking is left.',
    REVIEW_TASK_CLAIMS_LINE,
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
// A severity tag the Chief Engineer put on its own objection is dropped: the Chief Architect's ruling decides that.
const untag = (headline: string) => headline.replace(/^\s*[(\[](minor|blocking|major|critical|nit)[)\]][:\s]*/i, '');

function engineerObjections(reply: string): { n: number; headline: string; evidence: string }[] {
  return readObjections(reply).map(o => ({ ...o, headline: untag(o.headline) }));
}

function readObjections(reply: string): { n: number; headline: string; evidence: string }[] {
  const bold = objectionHeadlines(reply);
  if (bold.length) return bold;
  const out: { n: number; headline: string; evidence: string }[] = [];
  for (const line of reply.split('\n')) {
    const m = /^(\d+)\.\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const headline = m[2].split(/(?<=[.!?])\s/)[0];
    out.push({ n: parseInt(m[1], 10), headline, evidence: m[2] });
  }
  return out;
}

const LOCATION = /(?<![\w./-])[\w./-]*[\w-]\.[A-Za-z]{1,5}:\d+(?:-\d+)?\b/;

/** The first file:line an objection cites, keeping a leading dot (`.github/...`). */
export const findLocation = (text: string) => LOCATION.exec(text)?.[0];

type Ruling = 'STANDS' | 'MINOR' | 'OVERRULED' | 'MEASURE';
interface Judged extends TopObjection { latest: number; final?: Ruling }

const STRENGTH: Record<Ruling, number> = { STANDS: 4, MEASURE: 3, MINOR: 1, OVERRULED: 0 };
/** The stronger of two rulings on the same objection; no ruling is weaker than any ruling. */
const stronger = (a?: Ruling, b?: Ruling): Ruling | undefined => (!a ? b : !b ? a : STRENGTH[a] >= STRENGTH[b] ? a : b);
const keyOf = (headline: string) => headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
const asRuling = (r?: string): Ruling | undefined => {
  const u = String(r || '').toUpperCase();
  return u === 'STANDS' || u === 'MINOR' || u === 'OVERRULED' || u === 'MEASURE' ? u : undefined;
};

/**
 * Every objection the review raised, once, with the last ruling the Chief Architect gave it and where it stands now:
 * - blocking: upheld (STANDS), sent to be measured (MEASURE), or still open in the last round with no ruling at all.
 *   A review never changes the code between rounds, so an upheld objection keeps blocking: a later ruling never weakens
 *   an earlier one, and the Chief Engineer going quiet about it, or the seats signing off the brief, does not clear it.
 * - minor: ruled MINOR, or an advisory concern in the Chief Architect's latest review. Right, but it does not block.
 * - resolved: never upheld, and settled since: the Chief Engineer did not raise it again, ended with no open objection,
 *   or every seat signed off. Shown, never counted.
 * When the Chief Engineer restates an upheld objection in a later round in other words, both cite the same file:line;
 * the later one is folded into the earlier so one defect is not counted twice. Two in the same round are never folded,
 * into each other or into the same earlier objection.
 * OVERRULED objections are left out. Of the Chief Architect's own reviews, only the latest one's concerns still count.
 */
function judgedObjections(replay: SessionReplay): { kept: Judged[]; overruled: number; orphans: Record<'stands' | 'measure' | 'minor' | 'unruled', number> } {
  const engineerRounds = replay.rounds.filter(r => r.engineer);
  const last = engineerRounds[engineerRounds.length - 1];
  const signedOff = replay.status === 'AWAITING_APPROVAL' || replay.status === 'APPROVED';
  const cleared = signedOff || last?.engineer?.openObjections === 0;
  const byKey = new Map<string, Judged>();
  const orphans = { stands: 0, measure: 0, minor: 0, unruled: 0 };
  let overruled = 0;
  for (const round of engineerRounds) {
    const open = round.engineer!.openObjections ?? 1;
    if (open === 0) continue;
    const rulings = round.tiebreak?.rulings || [];
    // The objection list only: a number counts once, and a numbered note past the declared count is not an objection
    // unless the Chief Architect ruled on it.
    const seenN = new Set<number>();
    const parsed = engineerObjections(round.engineer!.reply).filter(o => {
      if (seenN.has(o.n)) return false;
      seenN.add(o.n);
      return open === 999 || o.n <= open || rulings.some(r => r.id === o.n);
    });
    for (const o of parsed) {
      const ruling = asRuling(rulings.find(r => r.id === o.n)?.ruling);
      // A headline matches an earlier round's objection when the two do not cite different file:lines, and never another
      // objection in the same round: two objections that share a headline but nothing else stay two.
      const location = findLocation(`${o.headline} ${o.evidence}`);
      let key = keyOf(o.headline);
      const match = byKey.get(key);
      if (match && (match.latest === round.n || (match.location && location && match.location !== location))) key = `${key}#${round.n}.${o.n}`;
      const earlier = byKey.get(key);
      // A later round never weakens a ruling: a review does not change the code, so what was upheld stays upheld.
      byKey.set(key, {
        round: earlier ? earlier.round : round.n, seat: 'Chief Engineer', headline: earlier ? earlier.headline : o.headline, evidence: o.evidence,
        location: location || earlier?.location, latest: round.n, final: stronger(ruling, earlier?.final)
      });
    }
    // Rulings on objections the parser could not read still count. Nothing can later clear one it cannot name, so an
    // upheld one counts from whichever round it was in; minor and unruled ones only from the last round.
    for (const r of rulings.filter(r => !parsed.some(o => o.n === r.id))) {
      const k = asRuling(r.ruling);
      if (k === 'STANDS') orphans.stands++; else if (k === 'MEASURE') orphans.measure++;
      else if (round === last && !cleared) { if (k === 'MINOR') orphans.minor++; else if (!k) orphans.unruled++; }
    }
    if (round === last && !cleared) {
      overruled = rulings.filter(r => asRuling(r.ruling) === 'OVERRULED').length;
      // Objections the Chief Engineer declared but nobody can read or ruled on still block: an open count with nothing
      // readable behind it, or one higher than the objections read and ruled.
      const accounted = new Set([...parsed.map(o => o.n), ...rulings.map(r => r.id)]).size;
      if (open === 999) { if (!accounted) orphans.unruled += 1; } else if (open > accounted) orphans.unruled += open - accounted;
    }
  }
  const kept: Judged[] = [];
  const folded = new Set<string>();
  for (const o of byKey.values()) {
    if (o.final === 'OVERRULED') continue;
    const ruling = o.final === 'STANDS' || o.final === 'MEASURE' || o.final === 'MINOR' ? { ruling: o.final } : {};
    const state: TopObjection['state'] = o.final === 'STANDS' || o.final === 'MEASURE' ? 'blocking'
      : o.final === 'MINOR' ? 'minor'
        : cleared || o.latest !== last?.n ? 'resolved' : 'blocking';
    // Only a restatement in a later round folds, and an earlier objection takes at most one from each later round:
    // two objections at one file:line in the same round stay two, wherever they would fold.
    const into = state === 'blocking' && o.location
      ? kept.find(k => k.state === 'blocking' && k.location === o.location && k.latest !== o.latest && !folded.has(`${kept.indexOf(k)}@${o.latest}`))
      : undefined;
    if (into) { folded.add(`${kept.indexOf(into)}@${o.latest}`); continue; }
    kept.push({ ...o, ...ruling, state });
  }
  const reviews = replay.rounds.filter(r => r.architect);
  for (const round of reviews) {
    const latest = round === reviews[reviews.length - 1];
    for (const c of round.architect!.concerns) {
      const required = /REQUIRED/i.test(c.type);
      if (!required && !(latest && /ADVISORY/i.test(c.type))) continue;
      const headline = c.description.split(/(?<=\.)\s/)[0];
      const state: TopObjection['state'] = !latest || signedOff ? 'resolved' : required ? 'blocking' : 'minor';
      // Skip a concern only when the list already has the same point at least as strongly: a REQUIRED concern is never
      // dropped for matching an objection that was overruled, ruled minor or settled.
      const rank = (x?: TopObjection['state']) => (x === 'blocking' ? 2 : x === 'minor' ? 1 : 0);
      if (kept.some(k => keyOf(k.headline) === keyOf(headline) && rank(k.state) >= rank(state))) continue;
      kept.push({ round: round.n, seat: 'Chief Architect', headline, evidence: c.description, location: findLocation(c.description), latest: round.n, state });
    }
  }
  return { kept, overruled, orphans };
}

/**
 * The objections worth leading with: those that block first, then the minor notes, then those settled along the way.
 * Within each, the Chief Engineer's earliest round first (later rounds argue over the fix plan), those that cite a
 * file:line ahead of those that don't, then the Chief Architect's own concerns. An objection it OVERRULED is left out.
 */
export function topObjections(replay: SessionReplay, limit = 3): TopObjection[] {
  const { kept } = judgedObjections(replay);
  // Headlines that lean on the session's own labels ("ruling R2", "FR7") mean little to anyone outside it.
  const jargon = (o: TopObjection) => (/\b(N?FR|R)\d+\b|\bruling\b/i.test(o.headline) ? 5 : 0);
  const upheld = (o: TopObjection) => (o.ruling === 'STANDS' ? 0 : o.ruling === 'MEASURE' ? 1 : 2);
  const tier = (o: TopObjection) => (o.state === 'minor' ? 1000 : o.state === 'resolved' ? 2000 : 0);
  const rank = (o: TopObjection) => tier(o) + (o.seat === 'Chief Engineer' ? 0 : 100) + (o.location ? 0 : 10) + jargon(o) + o.round * 8 + upheld(o);
  return kept.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).slice(0, limit)
    .map(({ o }) => { const { latest, final, ...top } = o; return top; });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The review's verdict. PASS needs nothing blocking left; it never needs every seat to sign off the PRD. */
export function reviewVerdict(replay: SessionReplay): ReviewVerdict {
  const signedOff = replay.status === 'AWAITING_APPROVAL' || replay.status === 'APPROVED';
  const { kept, overruled, orphans } = judgedObjections(replay);
  const blockingNow = kept.filter(o => o.state === 'blocking');
  const count = (f: (o: Judged) => boolean) => blockingNow.filter(f).length;
  const stands = count(o => o.ruling === 'STANDS') + orphans.stands;
  const measure = count(o => o.ruling === 'MEASURE') + orphans.measure;
  // A RETHINK with no concern behind it still says the change should not ship as is.
  const rethink = !signedOff && /RETHINK/i.test([...replay.rounds].reverse().find(r => r.architect)?.architect?.verdict || '');
  const required = Math.max(count(o => o.seat === 'Chief Architect'), rethink ? 1 : 0);
  const unruled = count(o => o.seat === 'Chief Engineer' && !o.ruling) + orphans.unruled;
  const minor = kept.filter(o => o.state === 'minor').length + orphans.minor;
  const reviewed = replay.rounds.some(r => r.engineer);
  // The Chief Engineer's own last word blocks too, whatever its objection count: a RETHINK says the change should not
  // ship, and a question it left for the Chief Architect is a doubt nobody settled.
  // A question the Chief Architect answered (its ruling for that round is in architect-rulings.json) is settled.
  const lastRound = [...replay.rounds].reverse().find(r => r.engineer);
  const lastEngineer = lastRound?.engineer;
  const engineerRethink = !signedOff && /RETHINK/i.test(lastEngineer?.verdict || '');
  const answered = (replay.rulings || []).filter(r => r.askedBy === 'chief_engineer' && r.stage === `round ${lastRound?.n}` && r.ruling.trim()).length;
  const questions = signedOff || !lastEngineer ? 0 : Math.max(0, extractArchitectQuestions(lastEngineer.reply).length - answered);
  const blocking = stands + measure + required + unruled + questions + (engineerRethink ? 1 : 0);
  const notes = minor ? plural(minor, 'minor note') : '';
  let verdict: ReviewVerdict['verdict'];
  let summary: string;
  if (!reviewed && !signedOff) {
    verdict = 'NO VERDICT';
    summary = 'no seat reviewed the change';
  } else if (blocking) {
    verdict = 'CHANGES REQUESTED';
    summary = [
      stands && `${plural(stands, 'objection stands', 'objections stand')}`,
      measure && `${measure} to verify`,
      required && `${plural(required, 'concern', 'concerns')} the Chief Architect marked required`,
      unruled && `${plural(unruled, 'objection', 'objections')} nobody ruled on`,
      questions && `${plural(questions, 'question', 'questions')} for the Chief Architect left open`,
      engineerRethink && "the Chief Engineer's verdict is RETHINK"
    ].filter(Boolean).join(', ') + (notes ? `; ${notes}` : '') + (overruled ? `; the Chief Architect overruled ${plural(overruled, 'objection')}` : '');
  } else {
    verdict = 'PASS';
    summary = [signedOff && !minor ? 'every seat signed off' : 'no blocking objection', notes, overruled && `the Chief Architect overruled ${plural(overruled, 'objection')}`]
      .filter(Boolean).join('; ');
  }
  return { verdict, stands, measure, unruled, required, minor, overruled, questions, engineerRethink, signedOff, summary };
}

const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();

/**
 * Who reviewed, as a share line can say it without overclaiming: the vendors that actually answered ("Claude, Gemini
 * and Grok"), or for a single-vendor review the vendor and its models ("three Claude seats (sonnet and opus)").
 * Sessions from before seats.json existed say "three AI seats", which names no vendor.
 */
export function councilPhrase(replay: SessionReplay): string {
  const answered = replay.seats?.answered || [];
  if (!answered.length) return 'three AI seats';
  const vendors = answeredVendors(replay.seats!);
  if (vendors.length > 1) return joinNames(vendors);
  const models = Array.from(new Set(answered.map(a => a.model).filter(Boolean)));
  const seats = new Set(answered.map(a => a.seat)).size;
  return `${seats === 3 ? 'three' : seats === 2 ? 'two' : 'one'} ${vendors[0]} seat${seats === 1 ? '' : 's'}${models.length ? ` (${joinNames(models)})` : ''}`;
}

/** One line someone can paste anywhere: the verdict, the first objection in the council's own words, and how to run one. */
export function shareLine(replay: SessionReplay, top: TopObjection[], verdict: ReviewVerdict = reviewVerdict(replay)): string {
  const who = councilPhrase(replay);
  const Who = `${who[0].toUpperCase()}${who.slice(1)}`;
  const subject = /^Review this change before it ships\./.test(replay.task) ? 'change' : 'plan';
  const tryIt = 'Try it on yours: npx open-council-cli review';
  const verb = replay.rounds.filter(r => r.engineer).length > 1 ? 'argue over' : 'review';
  const what = subject === 'change' ? 'my change before shipping it' : 'my plan before building it';
  const first = top.find(o => o.state !== 'minor' && o.state !== 'resolved') || (verdict.verdict === 'PASS' ? top[0] : undefined);
  if (first) {
    const headline = clean(first.headline).replace(/[.:;]+$/, '');
    const where = first.location ? ` (${first.location})` : '';
    const passed = verdict.verdict === 'PASS' ? `, and it passed${verdict.minor ? ` with ${plural(verdict.minor, 'minor note')}` : ''}` : '';
    const kind = first.state === 'minor' ? 'First note' : 'First objection';
    const upheld = first.state !== 'minor' && first.state !== 'resolved' && first.ruling === 'STANDS' ? ', upheld by the Chief Architect' : '';
    return `I had ${who} ${verb} ${what}${passed}. ${kind}, from the ${first.seat}${upheld}: "${headline}"${where}. ${tryIt}`;
  }
  if (verdict.verdict === 'PASS') {
    const overruled = verdict.overruled || allOverruled(replay);
    const objected = overruled ? `: the Chief Engineer objected ${overruled === 1 ? 'once' : `${overruled} times`} and the Chief Architect overruled ${overruled === 1 ? 'it' : 'every one'}` : ' and found nothing to object to';
    return `${Who} reviewed my ${subject}${objected}. ${tryIt}`;
  }
  return `${Who} reviewed my ${subject}: ${verdict.summary}. ${tryIt}`;
}

/** The seats line and any gaps, for the top of a review page: who answered, and which seat failed and who took it. */
export function seatSummary(replay: SessionReplay): { lineup: string | null; gaps: string[] } {
  const record = replay.seats;
  if (!record) return { lineup: null, gaps: [] };
  const order: SeatName[] = ['lead_pm', 'chief_engineer', 'chief_architect'];
  const vendors = answeredVendors(record);
  const single = vendors.length === 1;
  const parts = order.map(seat => {
    const who = record.answered.filter(a => a.seat === seat);
    if (!who.length) return `${SEAT_LABELS[seat]}: did not answer`;
    return `${SEAT_LABELS[seat]} ${who.map(a => single ? a.model : `${vendorOf(a.provider)} (${a.model})`).join(', then ')}`;
  });
  const label = !vendors.length ? 'No seat answered' : single ? `${vendors[0]} only (single vendor)` : joinNames(vendors);
  const gaps = record.failures.map(f => `${SEAT_LABELS[f.seat]} on ${providerLabel(f.provider)} (${f.model}) ${f.reason} during ${f.stage}; ${f.replacedBy ? `${providerLabel(f.replacedBy.provider)} (${f.replacedBy.model}) took the seat` : 'nobody could take the seat, so that step was skipped'}.`);
  return { lineup: `${label}: ${parts.join(', ')}.`, gaps };
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
  /** How the deliberation ended: AWAITING_APPROVAL when every seat signed off the PRD, else STALLED. */
  outcome: 'AWAITING_APPROVAL' | 'STALLED';
  /** What the review comes to, from the Chief Architect's rulings. */
  verdict: ReviewVerdict;
  rounds: number;
  seconds: number;
  replay: SessionReplay;
  top: TopObjection[];
  share: string;
  htmlPath: string;
  mdPath: string;
  /** Who held each seat, and the seats that failed mid-run. */
  seats: { lineup: string | null; gaps: string[] };
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
  const verdict = reviewVerdict(replay);
  const share = shareLine(replay, top, verdict);
  const seats = seatSummary(replay);
  const htmlPath = path.join(dir, 'review.html');
  const mdPath = path.join(dir, 'review.md');
  fs.writeFileSync(htmlPath, renderReplayHtml(replay, { top, share, seats, verdict }), 'utf8');
  fs.writeFileSync(mdPath, renderReplayMarkdown(replay, { top, share, seats, verdict }), 'utf8');
  return { sessionId, outcome: result.outcome, verdict, rounds: result.rounds, seconds: Math.round((Date.now() - started) / 1000), replay, top, share, htmlPath, mdPath, seats };
}
