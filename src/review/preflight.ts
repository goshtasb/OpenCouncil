// The setup check `council review` runs before it spends anything, and `council doctor` runs on its own: which seat
// CLIs are installed, which of them answer, and the one command that fixes each one that does not. A CLI counts as
// ready only when it answers a one-word prompt, because that is the only check that catches a lost login or a
// used-up quota before a review is halfway through.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getAdapter } from '../adapters/registry.js';
import { DEFAULT_MODELS, PROVIDER_CLIS, PROVIDER_FIXES, ProviderId, SeatsPlan } from '../setup.js';
import { describeAuth } from '../utils/auth.js';
import { describeSeatError, joinNames, providerLabel, SEAT_LABELS, SeatErrorKind, vendorOf } from '../engine/seats.js';
import { SeatName } from '../utils/prompts.js';

/** The seats a review can use, in the order a failed seat looks for a replacement. */
export const CHECKED_PROVIDERS: ProviderId[] = ['claude-code', 'antigravity', 'grok-cli'];
/** Checked only when installed: Google stopped serving personal logins on gemini-cli, so it is never suggested. */
export const OPTIONAL_PROVIDERS: ProviderId[] = ['gemini-cli'];
export const FAILOVER_ORDER: ProviderId[] = ['claude-code', 'grok-cli', 'antigravity', 'gemini-cli'];

export type CheckStatus = 'ready' | 'not-installed' | 'not-signed-in' | 'quota' | 'model' | 'timeout' | 'error' | 'unchecked';

export interface ProviderCheck {
  provider: ProviderId;
  cli: string;
  status: CheckStatus;
  /** The model the check asked, when it asked one. */
  model?: string;
  /** One line on what happened. */
  detail: string;
  /** The command that fixes it, when there is one. */
  fix: string | null;
  /** Which login the CLI uses, and a warning when that is an API key rather than a plan. */
  auth: string;
  warning?: string;
  seconds: number;
}

export const PING_PROMPT = 'Reply with the single word: PONG';
export const PING_TIMEOUT_SECONDS = 60;

/** The model each provider is asked during the check: the one a review will use, except Claude, whose login is per account, so the fastest model will do. */
export function pingModel(provider: ProviderId): string {
  return provider === 'claude-code' ? 'haiku' : DEFAULT_MODELS[provider];
}

const STATUS_FOR: Record<SeatErrorKind, CheckStatus> = { quota: 'quota', login: 'not-signed-in', 'max-turns': 'error', timeout: 'timeout', model: 'model', error: 'error' };

function fixFor(provider: ProviderId, status: CheckStatus): string | null {
  const fixes = PROVIDER_FIXES[provider];
  switch (status) {
    case 'not-installed': return `${fixes.install}  then  ${fixes.login}`;
    case 'not-signed-in': return fixes.login;
    case 'model': return `${fixes.models}  (then set that seat's model in .council/config.yml)`;
    case 'quota': return 'wait for the usage limit to reset; until then reviews run without this seat';
    case 'timeout': return `run \`${PROVIDER_CLIS[provider]}\` by hand once to see what it is waiting for`;
    case 'error': return `run \`${PROVIDER_CLIS[provider]}\` by hand once and read its error`;
    default: return null;
  }
}

export interface PreflightOptions {
  /** Ask each installed CLI a one-word prompt (default). Off, installed counts as ready. */
  ping?: boolean;
  /** Models to ask, per provider, e.g. the ones a project's .council/config.yml sets. */
  models?: Partial<Record<ProviderId, string>>;
  timeoutSeconds?: number;
  env?: Record<string, string | undefined>;
}

async function checkOne(provider: ProviderId, options: PreflightOptions, cwd: string): Promise<ProviderCheck> {
  const started = Date.now();
  const cli = PROVIDER_CLIS[provider];
  const auth = describeAuth(provider, options.env);
  const done = (status: CheckStatus, detail: string, model?: string): ProviderCheck => ({
    provider, cli, status, model, detail, fix: fixFor(provider, status), auth: auth.label, warning: auth.warning, seconds: Math.round((Date.now() - started) / 100) / 10
  });
  const adapter = getAdapter(provider);
  let installed = false;
  try { installed = await adapter.isAvailable(); } catch { installed = false; }
  if (!installed) return done('not-installed', `\`${cli}\` is not on PATH`);
  if (options.ping === false) return done('unchecked', `installed; not asked (--no-check)`);
  const model = options.models?.[provider] || pingModel(provider);
  try {
    const reply = await adapter.runPrompt(PING_PROMPT, { cwd, model, timeoutSeconds: options.timeoutSeconds || PING_TIMEOUT_SECONDS });
    const login = auth.label.replace(/\s*\(run `[^`]+` once to sign in\)$/, '');
    return done('ready', `${/pong/i.test(reply) ? 'answered' : 'answered (not with PONG)'} on ${login}`, model);
  } catch (err: any) {
    const { kind, reason } = describeSeatError(err);
    return done(STATUS_FOR[kind], reason, model);
  }
}

/**
 * Checks every seat CLI at once and returns one result per provider. Asks nothing of a CLI that is not installed.
 * gemini-cli is checked only when installed. The prompts run in an empty temporary directory, so no repository
 * file is read or sent.
 */
export async function preflight(options: PreflightOptions = {}): Promise<ProviderCheck[]> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opencouncil-check-'));
  try {
    const optional: ProviderId[] = [];
    for (const p of OPTIONAL_PROVIDERS) {
      try { if (await getAdapter(p).isAvailable()) optional.push(p); } catch { /* not installed: not listed */ }
    }
    return await Promise.all([...CHECKED_PROVIDERS, ...optional].map(p => checkOne(p, options, cwd)));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/** The providers that can hold a seat, in failover order. `unchecked` (installed, not asked) counts. */
export function readyProviders(checks: ProviderCheck[]): ProviderId[] {
  const ready = new Set(checks.filter(c => c.status === 'ready' || c.status === 'unchecked').map(c => c.provider));
  return FAILOVER_ORDER.filter(p => ready.has(p));
}

const MARK: Record<CheckStatus, string> = { ready: '✓', unchecked: '·', 'not-installed': '✗', 'not-signed-in': '✗', quota: '✗', model: '✗', timeout: '✗', error: '✗' };
const WORDS: Record<CheckStatus, string> = { ready: 'ready', unchecked: 'installed', 'not-installed': 'not installed', 'not-signed-in': 'not signed in', quota: 'usage limit reached', model: 'model not offered', timeout: 'no answer', error: 'failed' };

/** The check as lines to print: one per provider, then its fix, then any API-key warning. */
export function formatChecks(checks: ProviderCheck[]): string[] {
  const lines: string[] = [];
  const width = Math.max(...checks.map(c => providerLabel(c.provider).length));
  for (const c of checks) {
    const time = c.status === 'not-installed' || c.status === 'unchecked' ? '' : `  (${c.seconds} s)`;
    lines.push(`  ${MARK[c.status]} ${providerLabel(c.provider).padEnd(width)}  ${WORDS[c.status]}: ${c.detail}${time}`);
    if (c.fix && c.status !== 'ready' && c.status !== 'unchecked') lines.push(`      fix: ${c.fix}`);
    if (c.warning && (c.status === 'ready' || c.status === 'unchecked')) lines.push(`      ! ${c.warning}`);
  }
  return lines;
}

export interface Lineup {
  vendors: string[];
  singleVendor: boolean;
  /** "Claude, Gemini and Grok" or "Claude only (single vendor)". */
  label: string;
  /** "Lead PM Gemini (gemini-4-argon-high), Chief Engineer Claude (opus), Chief Architect Grok (grok-4.6)". */
  seats: string;
}

/** Says plainly who sits where, and whether the review is cross-vendor at all. */
export function describeLineup(seats: Record<SeatName, { provider: string; model: string }>): Lineup {
  const order: SeatName[] = ['lead_pm', 'chief_engineer', 'chief_architect'];
  const vendors: string[] = [];
  for (const s of order) if (!vendors.includes(vendorOf(seats[s].provider))) vendors.push(vendorOf(seats[s].provider));
  const singleVendor = vendors.length === 1;
  const seatText = order.map(s => singleVendor ? `${SEAT_LABELS[s]} ${seats[s].model}` : `${SEAT_LABELS[s]} ${vendorOf(seats[s].provider)} (${seats[s].model})`).join(', ');
  return { vendors, singleVendor, label: singleVendor ? `${vendors[0]} only (single vendor)` : joinNames(vendors), seats: seatText };
}

/** What a review would run with, from the plan: "Claude, Gemini and Grok: Lead PM ..." plus how to widen a single-vendor one. */
export function lineupLines(plan: Pick<SeatsPlan, 'seats'>, checks?: ProviderCheck[], runningNow = true): string[] {
  const lineup = describeLineup(plan.seats);
  const lines = [`${lineup.label}: ${lineup.seats}.`];
  if (checks && lineup.vendors.length < 3) {
    const missing = checks.filter(c => c.status !== 'ready' && c.status !== 'unchecked' && !lineup.vendors.includes(vendorOf(c.provider)) && c.provider !== 'gemini-cli');
    if (missing.length) lines.push(`For a ${lineup.singleVendor ? 'cross-vendor' : 'three-vendor'} council, fix ${joinNames(missing.map(c => providerLabel(c.provider)))} above.${runningNow ? ` This review runs without ${missing.length === 1 ? 'it' : 'them'}.` : ''}`);
  }
  return lines;
}
