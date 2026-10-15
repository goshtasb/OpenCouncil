// Seat planning for `council init`: which providers are installed, which seat each one should hold,
// and how the shipped config.yml template is rewritten for that plan. Pure functions except detectProviders.
import { getAdapter } from './adapters/registry.js';
import { SeatName } from './utils/prompts.js';
import { Profile } from './engine/deliberation-prompts.js';

export type ProviderId = 'claude-code' | 'grok-cli' | 'antigravity' | 'gemini-cli' | 'ollama';
export type CouncilMode = 'full' | 'solo' | 'mixed' | 'none';

export interface SeatPlan { provider: string; model: string }
export interface SeatsPlan {
  mode: CouncilMode;
  seats: Record<SeatName, SeatPlan>;
  /** Plain-language reasons for every non-default choice, printed by `council init`. */
  notes: string[];
}

export const PROVIDER_CLIS: Record<ProviderId, string> = {
  'claude-code': 'claude',
  'grok-cli': 'grok',
  antigravity: 'agy',
  'gemini-cli': 'gemini',
  ollama: 'ollama'
};

/** The one command that installs each provider CLI (macOS/Linux), and the one that signs in. */
export const PROVIDER_FIXES: Record<ProviderId, { install: string; login: string; models: string }> = {
  'claude-code': { install: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude auth login', models: 'use an alias: opus, sonnet or haiku' },
  'grok-cli': { install: 'curl -fsSL https://x.ai/cli/install.sh | bash', login: 'grok login', models: 'grok models' },
  antigravity: { install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', login: 'agy   (sign in through the browser prompt)', models: 'agy models' },
  'gemini-cli': { install: 'npm install -g @google/gemini-cli', login: 'gemini   (sign in through the browser prompt)', models: 'gemini --help' },
  ollama: { install: 'curl -fsSL https://ollama.com/install.sh | sh', login: 'ollama pull <model>', models: 'ollama list' }
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  'claude-code': 'opus',
  'grok-cli': 'grok-4.6',
  antigravity: 'gemini-3.1-pro-high',
  'gemini-cli': 'gemini-2.5-pro',
  ollama: 'llama3'
};

/** Every seat on Claude Code: the Lead and the Architect on sonnet, the Engineer (who implements) on opus. */
export const SOLO_SEATS: Record<SeatName, SeatPlan> = {
  lead_pm: { provider: 'claude-code', model: 'sonnet' },
  chief_engineer: { provider: 'claude-code', model: 'opus' },
  chief_architect: { provider: 'claude-code', model: 'sonnet' }
};

export const FULL_SEATS: Record<SeatName, SeatPlan> = {
  lead_pm: { provider: 'antigravity', model: DEFAULT_MODELS.antigravity },
  chief_engineer: { provider: 'claude-code', model: DEFAULT_MODELS['claude-code'] },
  chief_architect: { provider: 'grok-cli', model: DEFAULT_MODELS['grok-cli'] }
};

export async function detectProviders(): Promise<Set<ProviderId>> {
  const found = new Set<ProviderId>();
  for (const id of Object.keys(PROVIDER_CLIS) as ProviderId[]) {
    try {
      if (await getAdapter(id).isAvailable()) found.add(id);
    } catch {
      /* not installed */
    }
  }
  return found;
}

/**
 * Picks a provider for each seat from what is installed.
 * - Chief Engineer: Claude Code (the only provider verified for autonomous execution).
 * - Lead PM: Antigravity (Gemini) when present, otherwise Claude Code on sonnet.
 * - Chief Architect: Grok when present (zero-tool verified), otherwise Claude Code on sonnet with tools off.
 * Antigravity and gemini-cli never hold the Architect seat: they cannot be stripped of tools.
 */
export function planSeats(available: Set<string>): SeatsPlan {
  const has = (p: ProviderId) => available.has(p);
  const notes: string[] = [];
  if (available.size === 0) {
    return { mode: 'none', seats: { ...FULL_SEATS }, notes: ['No provider CLI was found on PATH. The default three-CLI config was written; run `council doctor` for the install command of each seat.'] };
  }
  if (has('claude-code') && has('antigravity') && has('grok-cli')) {
    return { mode: 'full', seats: { ...FULL_SEATS }, notes: ['Claude Code, Antigravity and Grok are all installed: one CLI per seat.'] };
  }
  if (has('claude-code') && !has('antigravity') && !has('grok-cli') && !has('gemini-cli')) {
    notes.push('Only Claude Code was found. Every seat runs on Claude Code (solo mode): Lead PM on sonnet, Chief Engineer on opus, Chief Architect on sonnet with all tools disabled.');
    if (has('ollama')) notes.push('Ollama is installed but the adapter is experimental (issue #2); it was not assigned a seat. Set a seat to provider "ollama" by hand to try it.');
    return { mode: 'solo', seats: { ...SOLO_SEATS }, notes };
  }

  const seats: Record<SeatName, SeatPlan> = { ...SOLO_SEATS };
  if (!has('claude-code')) {
    const fallback: ProviderId | undefined = (['grok-cli', 'antigravity', 'gemini-cli'] as ProviderId[]).find(has);
    seats.chief_engineer = { provider: fallback!, model: DEFAULT_MODELS[fallback!] };
    notes.push(`Claude Code is not installed. The Chief Engineer seat was given to ${fallback}; autonomous execution has only been verified on Claude Code. Install Claude Code: ${PROVIDER_FIXES['claude-code'].install}`);
  }
  if (has('antigravity')) {
    seats.lead_pm = { provider: 'antigravity', model: DEFAULT_MODELS.antigravity };
  } else if (has('gemini-cli')) {
    seats.lead_pm = { provider: 'gemini-cli', model: DEFAULT_MODELS['gemini-cli'] };
    notes.push('gemini-cli holds the Lead PM seat; some individual Gemini tiers no longer accept it. Prefer the Antigravity CLI (agy) if sessions fail.');
  } else {
    notes.push('No Gemini CLI found: the Lead PM seat runs on Claude Code (sonnet).');
  }
  if (has('grok-cli')) {
    seats.chief_architect = { provider: 'grok-cli', model: DEFAULT_MODELS['grok-cli'] };
  } else if (has('claude-code')) {
    notes.push('Grok is not installed: the Chief Architect seat runs on Claude Code (sonnet) with all tools disabled.');
  } else if (has('ollama')) {
    seats.chief_architect = { provider: 'ollama', model: DEFAULT_MODELS.ollama };
    notes.push('Neither Grok nor Claude Code is installed: the Chief Architect seat runs on Ollama (experimental adapter, issue #2).');
  }
  return { mode: 'mixed', seats, notes };
}

export const QUICK_COUNCIL = { max_rounds: 4, tiebreak_round: 3, signoff_revisions: 1, round_timeout_seconds: 600 };

/**
 * Rewrites the shipped config.yml template for a seat plan and profile, keeping every comment.
 * Only the `provider:` and `model:` lines of each seat, the `profile:` line and (for quick) the
 * round budget lines change, so a generated file still reads like the documented template.
 */
export function renderConfig(template: string, plan: SeatsPlan, options: { profile?: Profile; detected?: string[] } = {}): string {
  let out = template;
  for (const seat of Object.keys(plan.seats) as SeatName[]) {
    const { provider, model } = plan.seats[seat];
    const block = new RegExp(`(^  ${seat}:\\n(?:    .*\\n)*?    provider: )"[^"]*"`, 'm');
    if (!block.test(out)) throw new Error(`config template has no '${seat}' seat block`);
    out = out.replace(block, `$1"${provider}"`);
    out = out.replace(new RegExp(`(^  ${seat}:\\n(?:    .*\\n)*?    model: )"[^"]*"`, 'm'), `$1"${model}"`);
  }
  const profile = options.profile || 'full';
  if (!/^  profile: /m.test(out)) throw new Error("config template has no 'profile' line");
  out = out.replace(/^(  profile: )"[^"]*"/m, `$1"${profile}"`);
  if (profile === 'quick') {
    for (const [key, value] of Object.entries(QUICK_COUNCIL)) {
      out = out.replace(new RegExp(`^(  ${key}: )\\d+`, 'm'), `$1${value}`);
    }
  }
  const header = [
    `# Generated by \`council init\` (${plan.mode} mode${profile === 'quick' ? ', quick profile' : ''}).`,
    options.detected && options.detected.length > 0 ? `# Provider CLIs found on PATH: ${options.detected.join(', ')}.` : '# No provider CLI was found on PATH when this file was written.',
    '# Change any seat below and run `council doctor` to check it answers.'
  ].join('\n');
  return `${header}\n${out}`;
}

export function describePlan(plan: SeatsPlan): string[] {
  return (Object.keys(plan.seats) as SeatName[]).map(seat => `${seat.padEnd(16)} ${plan.seats[seat].provider} (${plan.seats[seat].model})`);
}
