// Every seat call goes through runSeat. It records which provider and model answered for each seat, and, when
// council.seat_failover is on, it drops a seat's model (or, for a lost login, its provider) after a failure and hands the seat to the next provider in
// council.failover_providers instead of ending the run. The record (seats.json) is what a replay shows as the
// line-up and the gaps, so a review never claims a vendor that did not answer.
import * as fs from 'fs';
import * as path from 'path';
import { AgentRunOptions } from '../adapters/base.js';
import { getAdapter } from '../adapters/registry.js';
import { CouncilConfig } from '../types.js';
import { SeatName } from '../utils/prompts.js';
import { SessionManager } from './session.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODELS } from '../setup.js';

export const SEATS_FILE = 'seats.json';

export interface SeatAssignment { provider: string; model: string }

export interface SeatFailure {
  seat: SeatName;
  provider: string;
  model: string;
  /** What the seat was doing, e.g. "draft v1", "round 1", "arbitration of round 1". */
  stage: string;
  kind: SeatErrorKind;
  /** One short line on what went wrong, never the command line (it carries the whole prompt). */
  reason: string;
  at: string;
  /** Who took the seat over; absent when nobody could. */
  replacedBy?: SeatAssignment;
}

export interface SeatsRecord {
  /** The seats the run started with. */
  planned: Record<SeatName, SeatAssignment>;
  /** Every provider/model that answered at least once, per seat, in order. */
  answered: Array<{ seat: SeatName; provider: string; model: string }>;
  failures: SeatFailure[];
}

/** Thrown when a seat failed and no provider is left that can take it. */
export class SeatUnavailableError extends Error {
  constructor(readonly seat: SeatName, readonly failures: SeatFailure[]) {
    super(`No provider is left for the ${SEAT_LABELS[seat]} seat: ${failures.filter(f => f.seat === seat).map(f => `${providerLabel(f.provider)} ${f.reason}`).join('; ') || 'every candidate was dropped earlier in this run'}.`);
    this.name = 'SeatUnavailableError';
  }
}

export const SEAT_LABELS: Record<SeatName, string> = { lead_pm: 'Lead PM', chief_engineer: 'Chief Engineer', chief_architect: 'Chief Architect' };

const VENDORS: Record<string, string> = { 'claude-code': 'Claude', antigravity: 'Gemini', 'gemini-cli': 'Gemini', 'grok-cli': 'Grok', ollama: 'Ollama' };

/** The company behind a provider, for "Claude, Gemini and Grok". Unknown providers are their own vendor. */
export const vendorOf = (provider: string) => VENDORS[provider] || provider;
/** "Claude", "Gemini (agy)", ... for messages that name a CLI. */
export const providerLabel = (provider: string) => provider === 'antigravity' ? 'Gemini (agy)' : provider === 'gemini-cli' ? 'Gemini (gemini-cli)' : vendorOf(provider);

export type SeatErrorKind = 'quota' | 'login' | 'max-turns' | 'timeout' | 'model' | 'error';

/** Classifies a seat CLI failure and says it in one line, without repeating the command line execa puts in the message. */
export function describeSeatError(err: any): { kind: SeatErrorKind; reason: string } {
  if (err?.name === 'AntigravityModelError') return { kind: 'model', reason: `does not offer model "${err.model}"` };
  const output = [err?.stderr, err?.stdout].filter((x: unknown) => typeof x === 'string' && x.trim()).join('\n');
  const message = typeof err?.command === 'string' && typeof err?.message === 'string'
    ? err.message.split(err.command).join('<command>')
    : String(err?.message || (typeof err === 'string' ? err : ''));
  const text = `${output}\n${message}`;
  const lastLine = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).pop() || '';
  const tail = (lastLine(output) || lastLine(message.replace(/<command>/g, ''))).slice(0, 160);
  if (err?.timedOut) return { kind: 'timeout', reason: 'timed out' };
  if (/\b429\b|quota|rate.?limit|resource.?exhausted|usage limit|limit reached|out of credits/i.test(text)) return { kind: 'quota', reason: `hit its usage limit${tail ? ` (${tail})` : ''}` };
  if (/max(imum)?[ _-]?turns/i.test(text)) return { kind: 'max-turns', reason: `stopped at its turn limit${tail ? ` (${tail})` : ''}` };
  // Only what a CLI prints about its own login counts, so a model's text about logins never drops the provider.
  // stdout can hold model text, so it counts only for Claude Code's own login lines, and only when stdout is that short
  // message and nothing else. Claude Code documents no format for these lines, so they are matched only at the start
  // of a line and only in a short stdout.
  // Everything else, a bare 401 or 403 included, counts only on stderr or execa's exit line, where no model text goes.
  // execa's message repeats stdout, so the exit line is its shortMessage when there is one.
  const CLAUDE_LOGIN = /^(invalid api key|please run \/login|failed to authenticate|oauth (access )?token (is invalid|has expired)|invalid bearer token|not logged in|api error: 40[13]\b)/i;
  const outLines = String(typeof err?.stdout === 'string' ? err.stdout : '').split('\n').map(l => l.trim()).filter(Boolean);
  const stdoutLogin = outLines.length > 0 && outLines.length <= 3 && outLines.some(l => CLAUDE_LOGIN.test(l));
  const exitLine = typeof err?.shortMessage === 'string' ? err.shortMessage.split(err.command || '\u0000').join('<command>') : message;
  const errText = `${typeof err?.stderr === 'string' ? err.stderr : ''}\n${exitLine}`;
  if (stdoutLogin
    || /invalid api key|please run \/login|not (logged|signed) in|please (log|sign) ?in|(log|sign) in again|unauthori[sz]ed|failed to authenticate|not authenticated|authentication (failed|error|required)|authentication_error|invalid (x-api-key|token|bearer token)|oauth (access )?token (is |has )?(invalid|expired|been revoked|revoked)|(token|session|credentials?|login) (has |have )?expired|permission[_ ]denied|\b40[13]\b/i.test(errText)) return { kind: 'login', reason: `is not signed in${tail ? ` (${tail})` : ''}` };
  return { kind: 'error', reason: tail ? `failed: ${tail}` : `exited with code ${err?.exitCode ?? 'unknown'}` };
}

/** The model a provider runs when it takes over a seat. Claude's Engineer gets opus, its other seats sonnet. */
export function failoverModel(provider: string, seat: SeatName, defaults: Record<string, string>): string {
  return failoverModels(provider, seat, defaults)[0];
}

/** Every model a provider may take a seat on, best first. Claude has separate limits per model, so opus and sonnet both count. */
export function failoverModels(provider: string, seat: SeatName, defaults: Record<string, string>): string[] {
  if (provider === 'claude-code') return seat === 'chief_engineer' ? ['opus', 'sonnet'] : ['sonnet', 'opus'];
  return [defaults[provider] || ''];
}

function recordPath(sessions: SessionManager, sessionId: string): string {
  return path.join(sessions.getSessionPath(sessionId), SEATS_FILE);
}

export function loadSeatsRecord(sessionDir: string): SeatsRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, SEATS_FILE), 'utf8')) as SeatsRecord;
  } catch {
    return null;
  }
}

function readRecord(config: CouncilConfig, sessions: SessionManager, sessionId: string): SeatsRecord {
  const existing = loadSeatsRecord(sessions.getSessionPath(sessionId));
  if (existing) return existing;
  const planned = {} as Record<SeatName, SeatAssignment>;
  for (const seat of Object.keys(SEAT_LABELS) as SeatName[]) planned[seat] = { provider: config.seats[seat].provider, model: config.seats[seat].model };
  return { planned, answered: [], failures: [] };
}

function writeRecord(sessions: SessionManager, sessionId: string, record: SeatsRecord): void {
  fs.writeFileSync(recordPath(sessions, sessionId), JSON.stringify(record, null, 2), 'utf8');
}

/**
 * Whether a provider and model were dropped earlier in this run. A lost login drops the whole provider, and so does a
 * usage limit anywhere but Claude. Any other failure (a model not offered, a turn limit, an error), and a usage limit on
 * Claude, drops only that model, because a Claude plan's opus limit says nothing about sonnet.
 */
export function isDropped(record: Pick<SeatsRecord, 'failures'>, provider: string, model: string): boolean {
  return record.failures.some(f => f.provider === provider && (f.kind === 'login' || (f.kind === 'quota' && provider !== 'claude-code') || f.model === model));
}

/**
 * The next provider for a seat, from config.council.failover_providers in order: not dropped, installed in the
 * registry, and able to run with no tools when the call needs none (the Chief Architect judges only the text it is given).
 */
function nextProvider(config: CouncilConfig, seat: SeatName, record: SeatsRecord, needsNoTools: boolean, defaults: Record<string, string>): SeatAssignment | null {
  // The seat's own provider always comes first, listed or not: it already holds the seat, so trying its other model
  // (Claude's sonnet after opus) sends nothing to a new vendor.
  const current = config.seats[seat].provider;
  for (const provider of [current, ...(config.council.failover_providers || []).filter(p => p !== current)]) {
    let adapter;
    try { adapter = getAdapter(provider); } catch { continue; }
    if (needsNoTools && adapter.canDisableTools === false) continue;
    // The seat's own provider is retried only on a model it knows by name, never on an empty default.
    const model = failoverModels(provider, seat, defaults).find(m => (provider !== current || m) && !isDropped(record, provider, m));
    if (model !== undefined) return { provider, model };
  }
  return null;
}

/**
 * Runs one seat call. On failure, with council.seat_failover on, the model (the provider, for a lost login) is dropped for the rest of the run, the
 * seat goes to the next provider in council.failover_providers, and the same call is made again. Every swap is written
 * to seats.json and to the session history. Throws SeatUnavailableError when no provider is left, and the original
 * error when failover is off.
 */
export async function runSeat(
  config: CouncilConfig,
  sessions: SessionManager,
  sessionId: string,
  seat: SeatName,
  stage: string,
  prompt: string,
  options: Omit<AgentRunOptions, 'model'>
): Promise<string> {
  const record = readRecord(config, sessions, sessionId);
  const needsNoTools = !options.permissionMode;
  // A seat whose provider or model was dropped earlier (say Gemini ran out of quota as Lead PM) moves before it is called again.
  if (config.council.seat_failover && isDropped(record, config.seats[seat].provider, config.seats[seat].model)) {
    const next = nextProvider(config, seat, record, needsNoTools, DEFAULT_MODELS);
    if (!next) throw new SeatUnavailableError(seat, record.failures);
    reassign(config, sessions, sessionId, seat, next, `${providerLabel(config.seats[seat].provider)} (${config.seats[seat].model}) was dropped earlier in this run`);
  }
  while (true) {
    const { provider, model } = config.seats[seat];
    try {
      const reply = await getAdapter(provider).runPrompt(prompt, { ...options, model });
      const latest = readRecord(config, sessions, sessionId);
      if (!latest.answered.some(a => a.seat === seat && a.provider === provider && a.model === model)) {
        latest.answered.push({ seat, provider, model });
        writeRecord(sessions, sessionId, latest);
      }
      return reply;
    } catch (err: any) {
      if (!config.council.seat_failover) throw err;
      const { kind, reason } = describeSeatError(err);
      const latest = readRecord(config, sessions, sessionId);
      const failure: SeatFailure = { seat, provider, model, stage, kind, reason, at: new Date().toISOString() };
      latest.failures.push(failure);
      const next = nextProvider(config, seat, latest, needsNoTools, DEFAULT_MODELS);
      if (next) failure.replacedBy = next;
      writeRecord(sessions, sessionId, latest);
      sessions.logEvent(sessionId, `${SEAT_LABELS[seat]} seat failed on ${providerLabel(provider)} (${model}) during ${stage}: ${reason}`);
      logger.warn(`${SEAT_LABELS[seat]} (${providerLabel(provider)}, ${model}) ${reason} during ${stage}.${next ? ` ${providerLabel(next.provider)} (${next.model}) takes the seat; the review notes the gap.` : ' No other provider can take the seat.'}`);
      if (!next) throw new SeatUnavailableError(seat, latest.failures);
      reassign(config, sessions, sessionId, seat, next, `${providerLabel(provider)} ${reason}`);
    }
  }
}

function reassign(config: CouncilConfig, sessions: SessionManager, sessionId: string, seat: SeatName, next: SeatAssignment, why: string): void {
  config.seats[seat] = { ...config.seats[seat], provider: next.provider, model: next.model };
  sessions.logEvent(sessionId, `${SEAT_LABELS[seat]} seat moved to ${providerLabel(next.provider)} (${next.model}): ${why}`);
}

/** The vendors that actually answered, in seat order, e.g. ['Claude', 'Gemini', 'Grok'] or ['Claude']. */
export function answeredVendors(record: SeatsRecord): string[] {
  const out: string[] = [];
  for (const a of record.answered) if (!out.includes(vendorOf(a.provider))) out.push(vendorOf(a.provider));
  return out;
}

/** "Claude, Gemini and Grok", "Claude and Grok", "Claude". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
