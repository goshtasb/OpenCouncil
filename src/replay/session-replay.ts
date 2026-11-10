import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SeatsRecord, loadSeatsRecord } from '../engine/seats.js';

/**
 * Everything a replay shows, read from a session directory's own files. Nothing is summarised:
 * each field is a file's text or a value parsed from one. Absolute paths are shortened by scrub().
 */
export interface ReplayEvent { at: string; offsetSeconds: number; text: string }
export interface ReplayConcern { type: string; principle?: string; description: string }
export interface ReplayGate { name: string; command: string; passed: boolean; exitCode?: number; durationMs?: number; output: string }
export interface ReplayRuling { id?: string | number; askedBy?: string; stage?: string; question: string; ruling: string }
export interface ReplayRound {
  n: number;
  plan?: string;
  changes?: string;
  engineer?: { reply: string; verdict?: string; openObjections?: number };
  architect?: { reply: string; verdict?: string; concerns: ReplayConcern[]; summary?: string };
  signoff?: { reply: string; verdict?: string; summary?: string };
  /** The Chief Architect's rulings on the Chief Engineer's open objections of this round. */
  tiebreak?: { reply: string; rulings: Array<{ id: number; ruling: string; reason: string }>; summary?: string };
}
export interface SessionReplay {
  id: string;
  slug: string;
  profile: string;
  baseSha: string;
  maxRounds: number;
  signoffRevisions: number;
  status: string;
  task: string;
  events: ReplayEvent[];
  rulings: ReplayRuling[];
  rounds: ReplayRound[];
  prd?: { text: string; sha256: string };
  stalled?: string;
  verification?: { headSha: string; passed: boolean; gates: ReplayGate[] };
  commits?: string;
  diff?: string;
  blockedReason?: string;
  /** Who held each seat and which seats failed (seats.json); absent for sessions from before 0.4. */
  seats?: SeatsRecord;
}

/** Shortens machine-specific absolute paths so a replay can be shared. */
export function scrub(text: string): string {
  return text
    .replace(/\/root\/\.council\//g, '~/.council/')
    .replace(/\/(?:home|Users)\/[^/\s]+\/\.council\//g, '~/.council/')
    .replace(/\/(?:home|Users)\/[^/\s]+\//g, '~/')
    .replace(/\/tmp\/claude[^\s`'")]*\/runs\/([A-Za-z0-9_-]+)/g, '<local copy of $1>');
}

function read(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; }
}

function readJson<T>(file: string): T | undefined {
  const text = read(file);
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as T; } catch { return undefined; }
}

function numbered(dir: string, prefix: string): number[] {
  return fs.readdirSync(dir)
    .map(name => new RegExp(`^${prefix}-(\\d+)$`).exec(name))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => a - b);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseHistory(history: string): ReplayEvent[] {
  const parsed: { at: string; time: number; text: string }[] = [];
  for (const line of history.split('\n')) {
    const m = /^\[(.+?)\] (.*)$/.exec(line);
    if (!m) continue;
    const time = Date.parse(m[1]);
    if (Number.isNaN(time)) continue;
    parsed.push({ at: m[1], time, text: scrub(m[2]) });
  }
  const t0 = parsed.length ? parsed[0].time : 0;
  return parsed.map(e => ({ at: e.at, offsetSeconds: Math.round((e.time - t0) / 1000), text: e.text }));
}

/** Reads a session directory (as written by the harness) into a replay. Throws if it has no meta.json. */
export function loadSessionReplay(sessionDir: string): SessionReplay {
  const meta = readJson<Record<string, any>>(path.join(sessionDir, 'meta.json'));
  if (!meta) throw new Error(`${sessionDir} is not a council session (no readable meta.json).`);
  const status = readJson<Record<string, any>>(path.join(sessionDir, 'STATUS.json')) || {};
  const details = status.details || {};

  const rounds: ReplayRound[] = [];
  const roundNumbers = new Set<number>([
    ...numbered(sessionDir, 'round'), ...numbered(sessionDir, 'review'), ...numbered(sessionDir, 'signoff')
  ]);
  for (const n of Array.from(roundNumbers).sort((a, b) => a - b)) {
    const round: ReplayRound = { n };
    const plan = read(path.join(sessionDir, `plan-v${n}.md`));
    if (plan !== undefined) round.plan = scrub(plan);
    const changes = read(path.join(sessionDir, `changes-v${n}.md`));
    if (changes !== undefined) round.changes = scrub(changes);

    const engReply = read(path.join(sessionDir, `round-${pad2(n)}`, 'reply.md'));
    if (engReply !== undefined) {
      const v = readJson<Record<string, any>>(path.join(sessionDir, `round-${pad2(n)}`, 'verdict.json')) || {};
      round.engineer = { reply: scrub(engReply), verdict: v.verdict, openObjections: v.openObjections };
    }
    const archReply = read(path.join(sessionDir, `review-${pad2(n)}`, 'reply.md'));
    if (archReply !== undefined) {
      const r = readJson<Record<string, any>>(path.join(sessionDir, `review-${pad2(n)}`, 'review.json')) || {};
      const concerns: ReplayConcern[] = Array.isArray(r.concerns)
        ? r.concerns.map((c: any) => ({ type: String(c.type || ''), principle: c.principle, description: scrub(String(c.description || '')) }))
        : [];
      round.architect = { reply: scrub(archReply), verdict: r.verdict, concerns, summary: r.summary && scrub(r.summary) };
    }
    const tbReply = read(path.join(sessionDir, `tiebreak-${pad2(n)}`, 'reply.md'));
    if (tbReply !== undefined) {
      const t = readJson<Record<string, any>>(path.join(sessionDir, `tiebreak-${pad2(n)}`, 'rulings.json')) || {};
      const rulings = Array.isArray(t.rulings) ? t.rulings.map((x: any) => ({ id: Number(x.id), ruling: String(x.ruling || ''), reason: scrub(String(x.reason || '')) })) : [];
      round.tiebreak = { reply: scrub(tbReply), rulings, summary: t.summary && scrub(String(t.summary)) };
    }
    const signReply = read(path.join(sessionDir, `signoff-${pad2(n)}`, 'reply.md'));
    if (signReply !== undefined) {
      const s = readJson<Record<string, any>>(path.join(sessionDir, `signoff-${pad2(n)}`, 'signoff.json')) || {};
      round.signoff = { reply: scrub(signReply), verdict: s.verdict, summary: s.summary && scrub(s.summary) };
    }
    rounds.push(round);
  }

  const replay: SessionReplay = {
    id: String(meta.id || path.basename(sessionDir)),
    slug: String(meta.slug || meta.id || path.basename(sessionDir)),
    profile: String(meta.profile || 'standard'),
    baseSha: String(meta.baseSha || ''),
    maxRounds: Number(meta.maxRounds || 0),
    signoffRevisions: Number(meta.signoffRevisions || 0),
    status: String(status.status || 'UNKNOWN'),
    task: scrub(read(path.join(sessionDir, 'task.md')) || ''),
    events: parseHistory(read(path.join(sessionDir, 'HISTORY.log')) || ''),
    rulings: (readJson<any[]>(path.join(sessionDir, 'architect-rulings.json')) || []).map(r => ({
      id: r.id, askedBy: r.askedBy, stage: r.stage, question: scrub(String(r.question || '')), ruling: scrub(String(r.ruling || ''))
    })),
    rounds
  };

  const prd = read(path.join(sessionDir, 'brief-and-prd.md'));
  if (prd !== undefined) {
    const lastSignoff = numbered(sessionDir, 'signoff').pop();
    const sj = lastSignoff !== undefined ? readJson<Record<string, any>>(path.join(sessionDir, `signoff-${pad2(lastSignoff)}`, 'signoff.json')) : undefined;
    replay.prd = { text: scrub(prd), sha256: String(sj?.planSha256 || details.prdSha256 || '') };
  }
  const stalled = read(path.join(sessionDir, 'stalled-draft-and-objections.md'));
  if (stalled !== undefined) replay.stalled = scrub(stalled);

  const ver = readJson<Record<string, any>>(path.join(sessionDir, 'verification', 'latest.json'));
  if (ver) {
    replay.verification = {
      headSha: String(ver.headSha || ''),
      passed: !!ver.passed,
      gates: (Array.isArray(ver.gates) ? ver.gates : []).map((g: any) => ({
        name: String(g.name || ''), command: String(g.command || ''), passed: !!g.passed,
        exitCode: g.exitCode, durationMs: g.durationMs, output: scrub(String(g.output || ''))
      }))
    };
  }

  // Commits: a recorded copy (shipped demos) wins; otherwise ask the execution checkout, if it still exists.
  const commits = read(path.join(sessionDir, 'execution', 'commits.txt'));
  const diff = read(path.join(sessionDir, 'execution', 'diff.patch'));
  if (commits !== undefined) {
    replay.commits = commits.trim();
    if (diff !== undefined) replay.diff = diff;
  } else if (typeof details.execWorktree === 'string' && replay.baseSha && fs.existsSync(path.join(details.execWorktree, '.git'))) {
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: details.execWorktree, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      replay.commits = git('log', '--format=%h %s', `${replay.baseSha}..HEAD`).trim();
      replay.diff = git('diff', `${replay.baseSha}..HEAD`);
    } catch { /* the checkout moved or was pruned: the replay simply has no commits section */ }
  }
  if (typeof details.blockedReason === 'string') replay.blockedReason = scrub(details.blockedReason);
  const seats = loadSeatsRecord(sessionDir);
  if (seats) replay.seats = { ...seats, failures: (seats.failures || []).map(f => ({ ...f, reason: scrub(String(f.reason || '')) })), answered: seats.answered || [] };
  return replay;
}

/** The numbered objections in a Chief Engineer reply: "1. **Headline.** evidence…". */
export function objectionHeadlines(reply: string): { n: number; headline: string; evidence: string }[] {
  const out: { n: number; headline: string; evidence: string }[] = [];
  const lines = reply.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let evidence = (m[3] || '').trim();
    // Seats often put the evidence on the next lines, as "- Evidence: ..." bullets; take the first one with content.
    for (let j = i + 1; !evidence && j < lines.length && !/^\d+\.\s/.test(lines[j]); j++) {
      evidence = lines[j].trim().replace(/^[-*]\s*/, '').replace(/^\*{0,2}(Evidence|Result|Why|Why it matters now)\s*:\s*\*{0,2}\s*/i, '').trim();
    }
    out.push({ n: parseInt(m[1], 10), headline: m[2].trim(), evidence });
  }
  return out;
}

/** The Lead PM's answers in a changes-vN file: "**1. Objection: adopted.**". */
export function responseHeadlines(changes: string): string[] {
  const out: string[] = [];
  for (const line of changes.split('\n')) {
    const m = /^\*\*\d+\.\s+(.+?)\*\*/.exec(line.trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** One plain sentence on why a run ended BLOCKED, from the harness's own reason text. */
export function describeBlock(reason: string): string {
  if (/pull request creation failed|gh auth login|GH_TOKEN/i.test(reason)) {
    return 'The gates passed, but this run had no GitHub sign-in, so the harness could not open the pull request. It ended BLOCKED instead of claiming DONE.';
  }
  if (/verification|gate/i.test(reason)) return 'A required gate failed, so nothing was pushed and the run ended BLOCKED.';
  const first = reason.split('\n').find(l => l.trim()) || reason;
  return first.length > 200 ? first.slice(0, 197) + '...' : first;
}

/** One objection the review page leads with. */
export interface TopObjection {
  round: number;
  seat: 'Chief Engineer' | 'Chief Architect';
  headline: string;
  evidence: string;
  location?: string;
  /** The Chief Architect's ruling on a Chief Engineer objection, when it arbitrated that round. */
  ruling?: 'STANDS' | 'MEASURE' | 'MINOR';
  /** blocking: holds up the change. minor: right, but it does not. resolved: raised earlier and settled since. */
  state?: 'blocking' | 'minor' | 'resolved';
}

/**
 * What a review comes to, from the Chief Architect's rulings rather than from the PRD sign-off: PASS when nothing that
 * blocks is left (minor notes may be), CHANGES REQUESTED when an objection stands, needs a measurement or was never ruled on.
 */
export interface ReviewVerdict {
  verdict: 'PASS' | 'CHANGES REQUESTED' | 'NO VERDICT';
  /** Objections the Chief Architect upheld as blocking. */
  stands: number;
  /** Objections the Chief Architect said need a measurement before anyone can tell. */
  measure: number;
  /** Objections still open at the end that nobody ruled on. */
  unruled: number;
  /** Concerns the Chief Architect itself marked REQUIRED. */
  required: number;
  /** Right but not blocking: MINOR rulings and the Chief Architect's advisory concerns. */
  minor: number;
  /** Objections the Chief Architect overruled in the last round. */
  overruled: number;
  /** Questions the Chief Engineer left for the Chief Architect in its last round. They block. */
  questions: number;
  /** The Chief Engineer's last verdict was RETHINK. It blocks whatever its objection count. */
  engineerRethink: boolean;
  /** The Chief Architect's last review could not be parsed, so its concerns could not be counted. It blocks. */
  architectUnread: boolean;
  /** Every seat signed off the PRD as well. */
  signedOff: boolean;
  /** One clause: "no blocking objection; 2 minor notes" or "2 objections stand, 1 to verify". */
  summary: string;
}
