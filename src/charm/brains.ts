import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRunOptions } from '../adapters/base.js';
import { getAdapter } from '../adapters/registry.js';
import { CharmBrain, CharmBrainConfig, CouncilConfig } from '../types.js';
import { BRAINS, BRAIN_LANES, CharmRoute, routeUtterance } from './router.js';

export interface CharmTurn {
  role: 'user' | 'charm';
  text: string;
  brain?: CharmBrain | 'panel';
}

export interface CharmAnswer {
  route: CharmRoute;
  /** What the charm says. */
  answer: string;
  /** Who said it: one brain, or the panel's judge. */
  speaker: CharmBrain;
  /** Every brain's own answer in panel mode (failed brains carry an error instead). */
  panel?: Partial<Record<CharmBrain, { answer?: string; error?: string; ms: number }>>;
  ms: number;
}

export type BrainState = 'idle' | 'thinking' | 'error';

const CHARM_PREAMBLE = [
  'You are one of three minds inside "the Charm", a pocket voice companion. Your reply is read aloud on a phone.',
  'Speak naturally: no markdown, no bullet symbols, no code blocks, no URLs read out, no emoji.',
  'Be brief — two to four sentences — unless the user asks for depth. Lead with the answer.',
  'If you cannot know something (for example it needs live data you do not have), say so in one sentence instead of guessing.'
].join('\n');

/**
 * Runs the three council CLIs as the charm's brains, on the subscriptions the council already uses.
 * Claude runs tool-less unless a named project lets it read that repository (plan mode, read-only).
 * Gemini (Antigravity) and Grok cannot be stripped of tools, so they run in an empty scratch directory.
 */
export class CharmBrains {
  readonly states: Record<CharmBrain, BrainState> = { claude: 'idle', gemini: 'idle', grok: 'idle' };
  private histories = new Map<string, CharmTurn[]>();
  private scratch: string;

  constructor(private config: CouncilConfig, scratchDir?: string) {
    this.scratch = scratchDir || fs.mkdtempSync(path.join(os.tmpdir(), 'opencouncil-charm-'));
  }

  brainConfig(brain: CharmBrain): CharmBrainConfig {
    const configured = this.config.charm.brains[brain];
    if (configured.model) return configured;
    // No charm-specific model: borrow the seat's, which `council doctor` already verifies.
    const seat = { claude: 'chief_engineer', gemini: 'lead_pm', grok: 'chief_architect' }[brain] as keyof CouncilConfig['seats'];
    const seatConfig = this.config.seats[seat];
    return { provider: configured.provider, model: seatConfig.provider === configured.provider ? seatConfig.model : '' };
  }

  history(conversationId: string): CharmTurn[] {
    return this.histories.get(conversationId) || [];
  }

  forget(conversationId: string): void {
    this.histories.delete(conversationId);
  }

  private remember(conversationId: string, turns: CharmTurn[]): void {
    const keep = Math.max(0, this.config.charm.history_turns) * 2;
    const all = [...this.history(conversationId), ...turns];
    this.histories.set(conversationId, keep ? all.slice(-keep) : []);
  }

  async route(text: string, options: { brain?: CharmBrain; mode?: CharmRoute['mode'] } = {}): Promise<CharmRoute> {
    return routeUtterance(text, this.config.charm, {
      ...options,
      askRouter: prompt => this.run(this.config.charm.routing.router, prompt, { cwd: this.scratch, timeoutSeconds: 30 })
    });
  }

  /** Route and answer one utterance (solo or panel). Council mode is handled by the server, which owns sessions. */
  async ask(text: string, conversationId = 'default', options: { brain?: CharmBrain; mode?: 'solo' | 'panel' } = {}): Promise<CharmAnswer> {
    const started = Date.now();
    const route = await this.route(text, options);
    if (route.mode === 'council') {
      return { route, answer: '', speaker: 'grok', ms: Date.now() - started };
    }
    const history = this.history(conversationId);
    let answer: string;
    let speaker: CharmBrain = route.brain;
    let panel: CharmAnswer['panel'];

    if (route.mode === 'panel') {
      const result = await this.panel(route, history);
      answer = result.answer;
      speaker = result.speaker;
      panel = result.panel;
    } else {
      answer = await this.askBrain(route.brain, route, history);
    }
    answer = toSpeech(answer);
    this.remember(conversationId, [
      { role: 'user', text: route.text },
      { role: 'charm', text: answer, brain: route.mode === 'panel' ? 'panel' : speaker }
    ]);
    return { route, answer, speaker, panel, ms: Date.now() - started };
  }

  async askBrain(brain: CharmBrain, route: CharmRoute, history: CharmTurn[], extra = ''): Promise<string> {
    const persona = this.config.charm.persona;
    const prompt = [
      CHARM_PREAMBLE,
      persona.prompt ? `Character — you all speak as ${persona.name || 'the charm'}. Stay in this voice, but the content of your answer must still be correct and useful:\n${persona.prompt}` : '',
      `Your lane — ${BRAIN_LANES[brain]}`,
      formatHistory(history),
      extra,
      `User: ${route.text}`
    ].filter(Boolean).join('\n\n');
    return this.withState(brain, () => this.run(this.brainConfig(brain), prompt, this.runOptions(brain, route)));
  }

  private runOptions(brain: CharmBrain, route: CharmRoute): AgentRunOptions {
    const timeoutSeconds = this.config.charm.timeout_seconds;
    if (brain === 'claude') {
      const repo = route.project ? this.config.charm.projects[route.project] : undefined;
      if (repo && fs.existsSync(repo)) {
        // Read-only research of the named project, exactly as the Chief Engineer researches during deliberation.
        return { cwd: repo, permissionMode: 'plan', timeoutSeconds };
      }
      return { cwd: this.scratch, timeoutSeconds };
    }
    if (brain === 'grok') {
      // Plan mode in an empty directory: nothing to read or edit, but its live web/X search stays available.
      return { cwd: this.scratch, permissionMode: 'plan', webSearch: true, timeoutSeconds };
    }
    // Antigravity: plan mode blocks edits; the scratch directory leaves it nothing of yours to read.
    return { cwd: this.scratch, permissionMode: 'plan', webSearch: true, timeoutSeconds };
  }

  /** All three answer in parallel; the judge reads the answers and gives the one the charm speaks. */
  async panel(route: CharmRoute, history: CharmTurn[]): Promise<{ answer: string; speaker: CharmBrain; panel: NonNullable<CharmAnswer['panel']> }> {
    const panel: NonNullable<CharmAnswer['panel']> = {};
    await Promise.all(BRAINS.map(async brain => {
      const t = Date.now();
      try {
        panel[brain] = { answer: toSpeech(await this.askBrain(brain, route, history)), ms: Date.now() - t };
      } catch (err: any) {
        panel[brain] = { error: shortError(err), ms: Date.now() - t };
      }
    }));
    const answered = BRAINS.filter(b => panel[b]?.answer);
    if (answered.length === 0) throw new Error(`No brain answered: ${BRAINS.map(b => `${b}: ${panel[b]?.error}`).join('; ')}`);
    if (answered.length === 1) return { answer: panel[answered[0]]!.answer!, speaker: answered[0], panel };

    const judge = this.config.charm.panel.judge;
    const views = answered.map(b => `${b.toUpperCase()} said:\n${panel[b]!.answer}`).join('\n\n');
    const ruling = [
      'You are the judge of a three-mind panel, like the Chief Architect of the council. Read the answers and give the final one the user hears.',
      'Say where they agree in one breath, name a real disagreement only if there is one and rule on it, and end with a clear recommendation.',
      '',
      views
    ].join('\n');
    try {
      const answer = await this.askBrain(judge, route, history, ruling);
      return { answer, speaker: judge, panel };
    } catch {
      const fallback = answered.includes(judge) ? judge : answered[0];
      return { answer: panel[fallback]!.answer!, speaker: fallback, panel };
    }
  }

  private async withState<T>(brain: CharmBrain, fn: () => Promise<T>): Promise<T> {
    this.states[brain] = 'thinking';
    try {
      const out = await fn();
      this.states[brain] = 'idle';
      return out;
    } catch (err) {
      this.states[brain] = 'error';
      setTimeout(() => { if (this.states[brain] === 'error') this.states[brain] = 'idle'; }, 10_000).unref();
      throw err;
    }
  }

  private run(brain: CharmBrainConfig, prompt: string, options: AgentRunOptions): Promise<string> {
    return getAdapter(brain.provider).runPrompt(prompt, { ...options, model: brain.model || undefined });
  }
}

function formatHistory(history: CharmTurn[]): string {
  if (history.length === 0) return '';
  return 'Conversation so far:\n' + history.map(t => `${t.role === 'user' ? 'User' : `Charm${t.brain ? ` (${t.brain})` : ''}`}: ${t.text}`).join('\n');
}

/** CLIs answer in markdown; the phone reads aloud. */
export function toSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code omitted — ask me to send it) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function shortError(err: any): string {
  return String(err?.shortMessage || err?.message || err).split('\n')[0].slice(0, 300);
}
