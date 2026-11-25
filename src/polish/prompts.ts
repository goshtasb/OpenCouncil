// Prompts and parsing for `council polish`. Pure functions: no I/O, no model calls.
//
// Why this shape (strategy notes, Nov 19 2026): debate rounds breed conformity and lose to independent
// answers plus one aggregation step, and hiding who said what cuts copied errors. So the critics never
// see each other, the merger sees them only as Critic A/B/C, and disagreements are kept, not voted away.

/** The sections every critic answers in, in order. */
export const CRITIQUE_SECTIONS = ['STRONGEST VERSION', 'WEAKEST POINTS', 'WHAT TO ADD', 'OPEN QUESTIONS'] as const;

/** The sections the merged version is written in, in order. */
export const SYNTHESIS_SECTIONS = ['POLISHED IDEA', 'WHAT CHANGED', 'DISAGREEMENTS', 'OPEN QUESTIONS FOR YOU'] as const;

export const POLISH_SYSTEM_PROMPT = [
  'You are one independent critic polishing a raw idea.',
  'You have no tools: no files, no shell, no web. Work only from the text you are given and answer in full; never say you will look something up.',
  'Be direct. Do not flatter the idea and do not hedge. If a part is weak or wrong, say so and say why.',
  'When you state a fact about the world (a law, a market, a company, a number), mark it [unverified] unless it is common knowledge, because nobody will check it for you.'
].join('\n');

export function critiquePrompt(idea: string): string {
  return [
    '# Polish this idea',
    '',
    'Below is a raw idea, possibly a fragment of a longer conversation, in its author\'s own words. Other critics are working on it separately; you will not see them and they will not see you.',
    'Your job: find the strongest version of this idea, attack its weakest points, and extend it.',
    '',
    'Answer in exactly these four sections, each starting with its heading on its own line:',
    '',
    '## STRONGEST VERSION',
    'Restate the idea as its best self in one tight paragraph: who it serves, what it does, why now. Fix vague parts; do not invent a different idea.',
    '',
    '## WEAKEST POINTS',
    'A numbered list, most serious first, at most 6. Each: the problem in bold, then one or two sentences on why it could sink the idea.',
    '',
    '## WHAT TO ADD',
    'A numbered list, at most 6: concrete mechanisms, features, partners or business-model pieces that would make it stronger. Each in one or two sentences.',
    '',
    '## OPEN QUESTIONS',
    'A numbered list, at most 5: the questions the author must answer before building, the most decisive first.',
    '',
    '---',
    '',
    '<idea>',
    idea.trim(),
    '</idea>'
  ].join('\n');
}

/** A critic's answer as handed to the merger: anonymous, by letter only. */
export interface LabeledCritique { label: string; text: string }

export function synthesisPrompt(idea: string, critiques: LabeledCritique[]): string {
  const blocks = critiques.map(c => [`<critique from="Critic ${c.label}">`, c.text.trim(), '</critique>'].join('\n'));
  return [
    '# Merge the critiques into one polished version',
    '',
    `${critiques.length} critics worked on the idea below independently, without seeing each other. Their critiques follow, labeled only by letter; you do not know which model wrote which, so judge each point on its merits, not on who made it or how many made it.`,
    '',
    'Write the most polished version of the idea. Take the strongest points from any critic, even one critic alone, and drop weak or redundant ones. Do not force a consensus: where critics genuinely disagree, or where a point is a judgment call only the author can make, keep it visible.',
    '',
    'Answer in exactly these four sections, each starting with its heading on its own line:',
    '',
    '## POLISHED IDEA',
    'The idea, rewritten as its best version: a one-line pitch, then a few short paragraphs or a short list covering who it serves, how it works, how it makes money and why it can win. Keep the author\'s core idea; do not swap it for a different one.',
    '',
    '## WHAT CHANGED',
    'A numbered list, at most 8: each change from the raw idea, with the critic letter(s) it came from, e.g. "(B, C)".',
    '',
    '## DISAGREEMENTS',
    'A numbered list of the real splits: what each side says, with critic letters, and which side you lean to and why in one sentence. Write "None." if the critics did not disagree on anything that matters.',
    '',
    '## OPEN QUESTIONS FOR YOU',
    'A numbered list, at most 5: the decisions only the author can make, the most decisive first.',
    '',
    '---',
    '',
    '<idea>',
    idea.trim(),
    '</idea>',
    '',
    ...blocks
  ].join('\n');
}

export function rebuttalPrompt(idea: string, merged: string): string {
  return [
    '# One rebuttal on the merged version',
    '',
    'Earlier you and other critics worked on the idea below independently. Someone merged the critiques into the polished version that follows. This is your one and only reply: there is no further round.',
    '',
    'Say what the merged version gets wrong, drops that it should have kept, or overstates. Do not repeat points it already handles, and do not restate your earlier critique.',
    '',
    'Answer as a numbered list of at most 5 points, most serious first. Each: the problem in bold, then one or two sentences. If you have nothing that matters to add, answer with the single line: NO OBJECTIONS.',
    '',
    '---',
    '',
    '<idea>',
    idea.trim(),
    '</idea>',
    '',
    '<merged-version>',
    merged.trim(),
    '</merged-version>'
  ].join('\n');
}

/**
 * Splits an answer into its `## HEADING` sections. Missing sections come back as ''. Matching is
 * case-insensitive and tolerates #, ## or ### and a trailing colon, because models vary the markup.
 */
export function parseSections(text: string, headings: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headings) out[h] = '';
  const lines = text.split(/\r?\n/);
  let current: string | null = null;
  const buf: Record<string, string[]> = {};
  for (const line of lines) {
    const m = /^\s*#{1,4}\s*\**\s*(.+?)\s*\**\s*:?\s*$/.exec(line);
    const hit = m ? headings.find(h => h.toLowerCase() === m[1].replace(/\*+/g, '').trim().toLowerCase()) : undefined;
    if (hit) { current = hit; buf[hit] = buf[hit] || []; continue; }
    if (current) buf[current].push(line);
  }
  for (const h of headings) if (buf[h]) out[h] = buf[h].join('\n').trim();
  return out;
}

/** Letters for the anonymous critics: A, B, C, ... */
export function criticLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * The order in which critics are lettered for the merger. A random shuffle by default, so the merger
 * cannot learn that "A" is always the same model; tests pass their own `random`.
 */
export function shuffledOrder(n: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** True when a rebuttal says it has nothing to add. */
export function isNoObjection(text: string): boolean {
  return /^\s*\**\s*NO OBJECTIONS\.?\s*\**\s*$/i.test(text.trim());
}
