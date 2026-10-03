import { CharmBrain, CharmConfig } from '../types.js';

/**
 * Who answers an utterance.
 *  solo    — one brain answers.
 *  panel   — all three answer in parallel; the judge (Grok by default, as the Chief Architect) gives the final word.
 *  council — a full Open Council session: a feature for the repository, deliberated, approved on the phone, shipped.
 */
export type CharmMode = 'solo' | 'panel' | 'council';

export interface CharmRoute {
  mode: CharmMode;
  /** The brain that answers (solo) or judges (panel). */
  brain: CharmBrain;
  /** How the decision was made, so a wrong route can be traced and the rules tuned. */
  via: 'override' | 'rules' | 'router' | 'default';
  reason: string;
  /** The utterance with any "ask Grok" style prefix removed. */
  text: string;
  /** A project the utterance names; Claude may read that repository (read-only). */
  project?: string;
  /** The utterance looks like work for the council; the charm offers to convene rather than spending quota unasked. */
  suggestCouncil?: boolean;
  scores?: Record<CharmBrain, number>;
}

export const BRAINS: CharmBrain[] = ['claude', 'gemini', 'grok'];

/**
 * Each brain's lane mirrors its council seat, so the charm and the council agree on who is good at what.
 * Claude = Chief Engineer, Gemini = Lead PM (Synapse), Grok = Chief Architect.
 */
export const BRAIN_LANES: Record<CharmBrain, string> = {
  claude: 'Chief Engineer: code, your repositories, debugging, careful step-by-step reasoning, math, writing and editing text.',
  gemini: 'Lead PM (Synapse): product thinking, brainstorming, research and explanations of the wider world, plans, long documents, translation.',
  grok: 'Chief Architect: what is happening right now (news, X, markets, sports), blunt opinions, settling disputes and making the call.'
};

// Speech recognisers mangle the names; accept the usual mishearings.
const NAME_PATTERNS: Record<CharmBrain, string> = {
  claude: 'claude|claud|clod',
  gemini: 'gemini|gemmy|jiminy|synapse',
  grok: 'grok|grock|groc|grox'
};

const PANEL_OVERRIDE = /\b(all three( of you)?|every ?one|the panel|all of you|both of you|what do you (all|guys) think|second opinion|ask (them )?all)\b/i;
const COUNCIL_OVERRIDE = /\b(convene|summon|call|open)( the)? council\b|^(the )?council[,:]|\bhave the council\b|\b(send|give|take) (it|this) to the council\b/i;

interface Rule {
  brain: CharmBrain | 'panel' | 'council';
  weight: number;
  pattern: RegExp;
}

// Weights: 3 = nearly decisive on its own, 2 = strong, 1 = a hint. A route needs 2+ and a 2-point lead.
const RULES: Rule[] = [
  // Claude — code and the user's repositories
  { brain: 'claude', weight: 3, pattern: /\b(code|coding|bug|debug|stack ?trace|exception|refactor|typescript|javascript|python|kotlin|rust|sql|regex|compile|lint|unit tests?|pull request|repo(sitory)?|commit|branch|merge conflict|endpoint|api|npm|function|deploy(ment)?)\b/i },
  { brain: 'claude', weight: 2, pattern: /\b(rewrite|proofread|edit (this|my)|tighten|draft (an? )?(email|reply|message|post)|summari[sz]e (this|that|it)|calculate|math|step by step|explain (this|the) (code|error))\b/i },
  // Gemini — product, research, ideas, the wider world
  { brain: 'gemini', weight: 3, pattern: /\b(brainstorm|ideas? for|product (idea|strategy|spec)|prd|user research|roadmap|go[- ]to[- ]market|positioning|competitors?|market size|tam)\b/i },
  { brain: 'gemini', weight: 2, pattern: /\b(research|look up|find out|learn about|history of|translate|recipe|travel|itinerary|plan (a|my)|youtube|maps?|directions)\b/i },
  { brain: 'gemini', weight: 1, pattern: /\b(how does .+ work|what is|who (is|was)|explain|tell me about)\b/i },
  // Grok — now, opinions, the call
  { brain: 'grok', weight: 3, pattern: /\b(news|headlines?|trending|today'?s?|tonight|right now|this (week|morning)|latest|on x|twitter|tweets?|what are people saying|bitcoin|btc|eth(ereum)?|solana|sol price|crypto|stocks?|market( is| today)?|score|game last night)\b/i },
  { brain: 'grok', weight: 2, pattern: /\b(be (honest|blunt|brutal)|roast|hot take|no filter|settle (this|it)|who'?s right|make the call|tie ?break|rule on|your honest opinion)\b/i },
  // Panel — decisions benefit from three views and a ruling
  { brain: 'panel', weight: 3, pattern: /\b(should i|which (one )?(is|should)|decide between|pros and cons|trade-?offs?|worth it|\bvs\.?\b|versus|compare)\b/i },
  // Council — building something in the repository; offered, never started unasked
  { brain: 'council', weight: 3, pattern: /\b(build|implement|ship|add (a|the) feature|write the (feature|code) for|make (a|the) change|fix .+ in (the )?(repo|codebase))\b/i }
];

export function scoreUtterance(text: string): Record<CharmBrain | 'panel' | 'council', number> {
  const scores = { claude: 0, gemini: 0, grok: 0, panel: 0, council: 0 };
  for (const rule of RULES) {
    if (rule.pattern.test(text)) scores[rule.brain] += rule.weight;
  }
  return scores;
}

export function findProject(text: string, projects: Record<string, string>): string | undefined {
  const lower = text.toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  // Longest names first so "open council" wins over "council".
  for (const name of Object.keys(projects).sort((a, b) => b.length - a.length)) {
    const n = name.toLowerCase();
    const sq = n.replace(/[^a-z0-9]/g, '');
    if (lower.includes(n) || (sq.length >= 4 && squashed.includes(sq))) return name;
  }
  return undefined;
}

/** Explicit instructions always win: "ask Grok…", "Gemini, …", "what do all three think…", "convene the council…". */
export function parseOverride(text: string): Partial<CharmRoute> | null {
  const trimmed = text.trim();
  if (COUNCIL_OVERRIDE.test(trimmed)) {
    const stripped = trimmed.replace(/^(hey |ok |okay )?(please )?((convene|summon|call|open)( the)? council|(the )?council|have the council)[,:]?\s*(to |and |on |about )?/i, '');
    return { mode: 'council', text: stripped || trimmed, reason: 'You asked for the council.' };
  }
  for (const brain of BRAINS) {
    const names = NAME_PATTERNS[brain];
    const lead = new RegExp(`^(?:hey |ok |okay |yo )?(?:${names})\\b[,:!]?\\s*`, 'i');
    const ask = new RegExp(`^(?:hey |ok |okay )?(?:please )?(?:ask|let|have|get) (?:${names})\\b[,:]?\\s*(?:to |about )?`, 'i');
    for (const re of [ask, lead]) {
      const m = trimmed.match(re);
      if (m) {
        const rest = trimmed.slice(m[0].length).trim();
        if (rest) return { mode: 'solo', brain, text: rest, reason: `You asked ${cap(brain)}.` };
      }
    }
  }
  if (PANEL_OVERRIDE.test(trimmed)) {
    return { mode: 'panel', text: trimmed, reason: 'You asked for all three.' };
  }
  return null;
}

/** Fast, free, deterministic routing. Returns null when the rules are not confident enough to decide. */
export function routeByRules(text: string, config: CharmConfig): CharmRoute | null {
  const project = findProject(text, config.projects);
  const s = scoreUtterance(text);
  if (project) s.claude += 3;
  const brainScores: Record<CharmBrain, number> = { claude: s.claude, gemini: s.gemini, grok: s.grok };
  const suggestCouncil = s.council >= 3 && (project !== undefined || s.claude >= 3);

  if (s.panel >= 3 && s.panel >= Math.max(s.claude, s.gemini, s.grok)) {
    return { mode: 'panel', brain: config.panel.judge, via: 'rules', reason: 'A decision: three views, one ruling.', text, project, suggestCouncil, scores: brainScores };
  }
  const ranked = [...BRAINS].sort((a, b) => brainScores[b] - brainScores[a]);
  const [top, second] = ranked;
  if (brainScores[top] >= 2 && brainScores[top] - brainScores[second] >= 2) {
    return { mode: 'solo', brain: top, via: 'rules', reason: laneReason(top), text, project, suggestCouncil, scores: brainScores };
  }
  return null;
}

export function buildRouterPrompt(text: string): string {
  return [
    'You route one spoken request to the right assistant. Reply with ONE line of JSON and nothing else:',
    '{"mode":"solo"|"panel","brain":"claude"|"gemini"|"grok","reason":"<under 12 words>"}',
    '',
    'Assistants:',
    ...BRAINS.map(b => `- ${b}: ${BRAIN_LANES[b]}`),
    '',
    'Use "panel" only for a real decision or a contested question where three views help; otherwise "solo".',
    'When unsure, pick claude.',
    '',
    `Request: ${JSON.stringify(text)}`
  ].join('\n');
}

export function parseRouterReply(reply: string): { mode: 'solo' | 'panel'; brain: CharmBrain; reason: string } | null {
  const match = reply.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const brain = String(parsed.brain || '').toLowerCase() as CharmBrain;
    const mode = String(parsed.mode || 'solo').toLowerCase();
    if (!BRAINS.includes(brain) || (mode !== 'solo' && mode !== 'panel')) return null;
    return { mode, brain, reason: String(parsed.reason || '').slice(0, 120) };
  } catch {
    return null;
  }
}

export interface RouteOptions {
  /** Force a brain or mode from the app (a long-press on one face, for instance). */
  brain?: CharmBrain;
  mode?: CharmMode;
  /** Runs the router model; injected so routing can be tested without a CLI. */
  askRouter?: (prompt: string) => Promise<string>;
}

/** Override → rules → router model → default. Each step is cheaper and more certain than the next. */
export async function routeUtterance(text: string, config: CharmConfig, options: RouteOptions = {}): Promise<CharmRoute> {
  const clean = text.trim();
  const project = findProject(clean, config.projects);

  if (options.mode || options.brain) {
    const mode = options.mode || 'solo';
    const brain = options.brain || (mode === 'panel' ? config.panel.judge : config.routing.default_brain);
    return { mode, brain, via: 'override', reason: 'Chosen in the app.', text: clean, project };
  }

  const override = parseOverride(clean);
  if (override) {
    const mode = override.mode as CharmMode;
    const brain = override.brain || (mode === 'panel' ? config.panel.judge : config.routing.default_brain);
    return { mode, brain, via: 'override', reason: override.reason || '', text: override.text || clean, project: findProject(override.text || clean, config.projects) };
  }

  const byRules = routeByRules(clean, config);
  if (byRules) return byRules;

  const suggestCouncil = scoreUtterance(clean).council >= 3 && project !== undefined;
  if (config.routing.llm_router && options.askRouter) {
    try {
      const parsed = parseRouterReply(await options.askRouter(buildRouterPrompt(clean)));
      if (parsed) {
        const brain = parsed.mode === 'panel' ? config.panel.judge : parsed.brain;
        return { mode: parsed.mode, brain, via: 'router', reason: parsed.reason || laneReason(brain), text: clean, project, suggestCouncil };
      }
    } catch {
      // A failed router never blocks an answer; fall through to the default brain.
    }
  }
  const brain = project ? 'claude' : config.routing.default_brain;
  return { mode: 'solo', brain, via: 'default', reason: laneReason(brain), text: clean, project, suggestCouncil };
}

function laneReason(brain: CharmBrain): string {
  return `${cap(brain)}'s lane — ${BRAIN_LANES[brain].split(':')[1].trim().split(',')[0]}.`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
