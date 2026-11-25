// `council polish`: run a raw idea past several AIs and get back one polished version.
//
// Three steps, and no more (see prompts.ts for why):
//   1. Blind pass: every critic critiques and extends the idea in parallel, without seeing the others.
//   2. One merge: Claude merges the critiques, which it sees only as Critic A/B/C, into one polished
//      version and keeps the disagreements visible.
//   3. Optional single rebuttal: each critic gets one reply to the merged version. It is shown as is;
//      nothing is merged again.
// No debate rounds, no tie-break, no sign-off. Seats run with no tools in an empty folder, so nothing
// but the idea is sent anywhere.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getAdapter } from '../adapters/registry.js';
import { DEFAULT_MODELS } from '../setup.js';
import { councilHome } from '../utils/paths.js';
import {
  CRITIQUE_SECTIONS, LabeledCritique, POLISH_SYSTEM_PROMPT, SYNTHESIS_SECTIONS,
  criticLabel, critiquePrompt, isNoObjection, parseSections, rebuttalPrompt, shuffledOrder, synthesisPrompt
} from './prompts.js';

export interface PolishSeat { provider: string; model?: string }

/** Claude, Gemini (through Antigravity) and Grok, each on its own subscription CLI. */
export const DEFAULT_POLISH_CRITICS: PolishSeat[] = [
  { provider: 'claude-code', model: DEFAULT_MODELS['claude-code'] },
  { provider: 'antigravity', model: DEFAULT_MODELS.antigravity },
  { provider: 'grok-cli', model: DEFAULT_MODELS['grok-cli'] }
];
export const DEFAULT_POLISH_MERGER: PolishSeat = { provider: 'claude-code', model: DEFAULT_MODELS['claude-code'] };

/** Longest idea accepted, in characters. A polish run is for an idea, not a document. */
export const MAX_IDEA_CHARS = 20000;
export const POLISH_TIMEOUT_SECONDS = 600;

const PROVIDER_NAMES: Record<string, string> = {
  'claude-code': 'Claude', antigravity: 'Gemini', 'gemini-cli': 'Gemini', 'grok-cli': 'Grok', ollama: 'Ollama'
};
export function seatName(seat: PolishSeat): string {
  return `${PROVIDER_NAMES[seat.provider] || seat.provider}${seat.model ? ` (${seat.model})` : ''}`;
}

/** Calls a run makes: one per critic, one merge, and one more per critic with the rebuttal. */
export function plannedCalls(critics: number, rebuttal: boolean): number {
  return critics + 1 + (rebuttal ? critics : 0);
}

export interface CriticResult {
  seat: PolishSeat;
  name: string;
  /** The anonymous letter the merger saw; '' when the critic failed and was not shown. */
  label: string;
  text?: string;
  error?: string;
  rebuttal?: string;
  rebuttalError?: string;
}

export interface PolishResult {
  id: string;
  dir: string;
  mdPath: string;
  critics: CriticResult[];
  merger: PolishSeat;
  merged: string;
  sections: Record<string, string>;
  /** Model calls actually made (not counting a transient-failure retry inside an adapter). */
  calls: number;
  seconds: number;
  gaps: string[];
}

export interface PolishOptions {
  critics?: PolishSeat[];
  merger?: PolishSeat;
  rebuttal?: boolean;
  /** Where polish.md is written. Default: ~/.council/polish/<id>/ */
  outDir?: string;
  timeoutSeconds?: number;
  /** For tests: the shuffle that letters the critics. */
  random?: () => number;
  onProgress?: (line: string) => void;
}

function errorText(err: any): string {
  const first = String(err?.shortMessage || err?.message || err).split('\n')[0];
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'idea';
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function runPolish(idea: string, options: PolishOptions = {}): Promise<PolishResult> {
  const text = (idea || '').trim();
  if (!text) throw new Error('Give the idea to polish: as words after `council polish`, with --file, or on stdin.');
  if (text.length > MAX_IDEA_CHARS) throw new Error(`The idea is ${text.length} characters; polish takes up to ${MAX_IDEA_CHARS}. Cut it to the idea itself.`);
  const critics = options.critics && options.critics.length ? options.critics : DEFAULT_POLISH_CRITICS;
  const merger = options.merger || DEFAULT_POLISH_MERGER;
  const timeoutSeconds = options.timeoutSeconds || POLISH_TIMEOUT_SECONDS;
  const progress = options.onProgress || (() => undefined);
  const started = Date.now();
  const id = `${stamp()}-${slug(text)}`;
  const dir = options.outDir || path.join(councilHome(), 'polish', id);
  // An empty folder as every seat's workspace: a CLI that reads its workspace finds nothing to read.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opencouncil-polish-'));
  const gaps: string[] = [];
  let calls = 0;
  const run = async (seat: PolishSeat, prompt: string): Promise<string> => {
    calls++;
    return getAdapter(seat.provider).runPrompt(prompt, { cwd, model: seat.model, systemPrompt: POLISH_SYSTEM_PROMPT, timeoutSeconds });
  };

  try {
    // 1. Blind pass, in parallel. Every critic gets the same prompt and nothing else.
    progress(`Blind pass: ${critics.map(seatName).join(', ')} critique the idea separately (${critics.length} calls).`);
    const prompt = critiquePrompt(text);
    const results: CriticResult[] = await Promise.all(critics.map(async seat => {
      const base: CriticResult = { seat, name: seatName(seat), label: '' };
      try { return { ...base, text: (await run(seat, prompt)).trim() }; } catch (err) { return { ...base, error: errorText(err) }; }
    }));
    for (const r of results) if (r.error) gaps.push(`${r.name} gave no critique: ${r.error}`);
    const answered = results.filter(r => r.text);
    if (!answered.length) throw new Error(`No critic answered, so there is nothing to merge.\n${gaps.map(g => `  - ${g}`).join('\n')}`);
    if (answered.length === 1) gaps.push(`Only ${answered[0].name} answered, so the polished version rests on one critic.`);

    // Letter the critics in a random order so the merger cannot tell which model wrote which.
    const order = shuffledOrder(answered.length, options.random);
    order.forEach((idx, i) => { answered[idx].label = criticLabel(i); });
    const labeled: LabeledCritique[] = [...answered].sort((a, b) => a.label.localeCompare(b.label)).map(r => ({ label: r.label, text: r.text! }));

    // 2. One merge.
    progress(`Merge: ${seatName(merger)} merges ${labeled.length} anonymous critiques (1 call).`);
    let merged: string;
    try {
      merged = (await run(merger, synthesisPrompt(text, labeled))).trim();
    } catch (err) {
      const partial = writeReport(dir, { id, idea: text, critics: results, merger, merged: '', sections: {}, calls, seconds: secondsSince(started), gaps: [...gaps, `${seatName(merger)} could not merge: ${errorText(err)}`], rebuttal: false });
      throw new Error(`${seatName(merger)} could not merge the critiques: ${errorText(err)}. The critiques are in ${partial}.`);
    }
    const sections = parseSections(merged, SYNTHESIS_SECTIONS);
    const missing = SYNTHESIS_SECTIONS.filter(h => !sections[h]);
    if (missing.length) gaps.push(`The merged version has no ${missing.join(', ')} section; it is shown as written.`);

    // 3. Optional single rebuttal, in parallel, shown as is.
    if (options.rebuttal) {
      progress(`Rebuttal: each critic gets one reply to the merged version (${answered.length} calls).`);
      const rp = rebuttalPrompt(text, merged);
      await Promise.all(answered.map(async r => {
        try { r.rebuttal = (await run(r.seat, rp)).trim(); } catch (err) { r.rebuttalError = errorText(err); gaps.push(`${r.name} gave no rebuttal: ${r.rebuttalError}`); }
      }));
    }

    const seconds = secondsSince(started);
    const mdPath = writeReport(dir, { id, idea: text, critics: results, merger, merged, sections, calls, seconds, gaps, rebuttal: !!options.rebuttal });
    return { id, dir, mdPath, critics: results, merger, merged, sections, calls, seconds, gaps };
  } finally {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function secondsSince(t: number): number {
  return Math.round((Date.now() - t) / 1000);
}

interface ReportInput {
  id: string; idea: string; critics: CriticResult[]; merger: PolishSeat; merged: string;
  sections: Record<string, string>; calls: number; seconds: number; gaps: string[]; rebuttal: boolean;
}

/** Writes polish.md and polish.json into `dir` and returns the Markdown path. */
export function writeReport(dir: string, r: ReportInput): string {
  fs.mkdirSync(dir, { recursive: true });
  const md = renderPolishMarkdown(r);
  const mdPath = path.join(dir, 'polish.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  fs.writeFileSync(path.join(dir, 'polish.json'), JSON.stringify({
    id: r.id, idea: r.idea, merger: r.merger, calls: r.calls, seconds: r.seconds, gaps: r.gaps,
    critics: r.critics.map(c => ({ ...c, sections: c.text ? parseSections(c.text, CRITIQUE_SECTIONS) : undefined })),
    merged: r.merged
  }, null, 2), 'utf8');
  return mdPath;
}

export function renderPolishMarkdown(r: ReportInput): string {
  const out: string[] = ['# Polished idea', ''];
  const shown = r.critics.filter(c => c.label).sort((a, b) => a.label.localeCompare(b.label));
  out.push(`${shown.length} critic${shown.length === 1 ? '' : 's'} worked blind, ${seatName(r.merger)} merged, ${r.calls} model call${r.calls === 1 ? '' : 's'}, ${r.seconds} s.`, '');
  if (r.gaps.length) out.push('**Gaps:**', ...r.gaps.map(g => `- ${g}`), '');
  const allHeadings = SYNTHESIS_SECTIONS.every(h => r.sections[h]);
  if (r.merged && allHeadings) {
    for (const h of SYNTHESIS_SECTIONS) out.push(`## ${titleCase(h)}`, '', r.sections[h], '');
  } else if (r.merged) {
    out.push('## Merged version', '', r.merged, '');
  }
  if (r.rebuttal) {
    out.push('## Rebuttals to the merged version', '');
    for (const c of shown) {
      const body = c.rebuttalError ? `_No rebuttal: ${c.rebuttalError}_` : c.rebuttal && isNoObjection(c.rebuttal) ? '_No objections._' : (c.rebuttal || '_No rebuttal._');
      out.push(`### Critic ${c.label}`, '', body, '');
    }
  }
  out.push('## Who was who', '', 'The merger saw only the letters. Revealed here:', '');
  for (const c of shown) out.push(`- Critic ${c.label}: ${c.name}`);
  for (const c of r.critics.filter(x => !x.label)) out.push(`- ${c.name}: no critique (${c.error})`);
  out.push('', '## The raw idea', '', ...r.idea.split('\n').map(l => `> ${l}`), '');
  out.push('## Each critique as written', '');
  for (const c of shown) out.push('<details>', `<summary>Critic ${c.label}: ${c.name}</summary>`, '', c.text || '', '', '</details>', '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function titleCase(h: string): string {
  return h.charAt(0) + h.slice(1).toLowerCase();
}
