import { SessionReplay, TopObjection } from './session-replay.js';

const quote = (text: string) => text.trim().split('\n').map(l => (l.trim() ? `> ${l}` : '>')).join('\n');

function details(summary: string, body: string, lang = ''): string {
  const fence = body.includes('```') ? '````' : '```';
  return `<details>\n<summary>${summary}</summary>\n\n${fence}${lang}\n${body.trim()}\n${fence}\n\n</details>\n`;
}

/**
 * The same replay as Markdown, for places that render it: a GitHub gist, an issue, a pull request comment.
 * Leads with what the council found; every seat reply follows, folded.
 */
export interface SeatLines { lineup: string | null; gaps: string[] }

/** How many objections the Chief Architect overruled when it overruled every open one in the last round, else 0. */
export function allOverruled(r: Pick<SessionReplay, 'rounds'>): number {
  const last = [...r.rounds].reverse().find(x => x.engineer);
  const rulings = last?.tiebreak?.rulings || [];
  return rulings.length && rulings.every(x => String(x.ruling).toUpperCase() === 'OVERRULED') ? rulings.length : 0;
}

/** What to say when the found list is empty: no objection at all, or every one overruled. */
export function nothingFoundText(r: Pick<SessionReplay, 'rounds'>): string {
  const n = allOverruled(r);
  return n ? `The Chief Engineer raised ${n} objection${n === 1 ? '' : 's'} and the Chief Architect overruled ${n === 1 ? 'it' : 'every one'}, so none stands.` : 'The council raised no objections.';
}

export function renderReplayMarkdown(r: SessionReplay, options: { top?: TopObjection[]; share?: string; replayUrl?: string; rounds?: boolean; seats?: SeatLines } = {}): string {
  const out: string[] = [];
  out.push(`## Council review: ${r.slug}`, '');
  const rounds = r.rounds.filter(x => x.engineer).length;
  const overruled = allOverruled(r);
  const meaning = r.status === 'STALLED' && overruled ? `: no objection stands (the Chief Architect overruled ${overruled === 1 ? 'the only one' : `all ${overruled}`}), but nothing was signed off` : r.status === 'STALLED' ? ': the seats did not all sign off, so it would not ship as is' : r.status === 'AWAITING_APPROVAL' || r.status === 'APPROVED' ? ': all three seats signed off' : '';
  out.push(`Outcome: **${r.status}** after ${rounds} round${rounds === 1 ? '' : 's'}${meaning} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`, '');
  if (options.seats?.lineup) out.push(`Seats: ${options.seats.lineup}`, '');
  if (options.seats?.gaps.length) {
    out.push('**Gaps in this review:**', '');
    options.seats.gaps.forEach(g => out.push(`- ${g}`));
    out.push('');
  }
  if (options.top && options.top.length) {
    out.push('### What the council found', '');
    options.top.forEach((o, i) => {
      out.push(`${i + 1}. **${o.headline.replace(/\*\*/g, '')}**${o.location ? ` (\`${o.location}\`)` : ''}  `);
      if (o.evidence && o.evidence !== o.headline) out.push(`   ${o.evidence.replace(/\n+/g, ' ')}`);
      out.push(`   _${o.seat}, round ${o.round}${o.ruling === 'STANDS' ? '; upheld by the Chief Architect' : o.ruling === 'MEASURE' ? '; the Chief Architect asked for a measurement' : ''}_`, '');
    });
  } else {
    out.push(nothingFoundText(r), '');
  }
  if (options.replayUrl) out.push(`[The full replay: every round, every seat](${options.replayUrl})`, '');
  if (options.rounds === false) {
    if (!options.replayUrl) out.push('_Every round is in the full replay._', '');
  } else {
    out.push('### Every round', '');
    for (const round of r.rounds) {
      if (round.changes) out.push(details(`Lead PM: what changed in v${round.n}`, round.changes, 'markdown'));
      if (round.engineer) out.push(details(`Chief Engineer, round ${round.n}: ${round.engineer.verdict || 'review'}`, round.engineer.reply, 'markdown'));
      if (round.tiebreak) out.push(details(`Chief Architect's rulings on round ${round.n}: ${rulingCounts(round.tiebreak.rulings)}`, round.tiebreak.reply, 'markdown'));
      if (round.architect) out.push(details(`Chief Architect on v${round.n}: ${round.architect.verdict || 'review'}`, round.architect.reply, 'markdown'));
      if (round.signoff) out.push(details(`Lead PM sign-off on v${round.n}: ${round.signoff.verdict || ''}`, round.signoff.reply, 'markdown'));
    }
    if (r.prd) out.push(details('The PRD all three seats signed off', r.prd.text, 'markdown'));
    if (r.stalled) out.push(details('Stalled: last draft and open objections', r.stalled, 'markdown'));
    out.push('', '<details><summary>The task</summary>', '', quote(r.task), '', '</details>', '');
  }
  if (options.share) out.push(`> ${options.share}`, '');
  out.push('<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>');
  return out.join('\n') + '\n';
}

/** "2 upheld, 1 overruled" from a round's rulings. */
export function rulingCounts(rulings: Array<{ ruling: string }>): string {
  const n = (r: string) => rulings.filter(x => x.ruling === r).length;
  const parts = [[n('STANDS'), 'upheld'], [n('OVERRULED'), 'overruled'], [n('MEASURE'), 'to measure']].filter(([c]) => c).map(([c, w]) => `${c} ${w}`);
  return parts.join(', ') || 'no parseable rulings';
}

/** The hidden line the GitHub Action looks for, so a re-run edits its own comment instead of adding another. */
export const PR_COMMENT_MARKER = '<!-- open-council-review -->';
/** GitHub rejects a comment body over 65,536 characters; stay well under it. */
export const PR_COMMENT_MAX_CHARS = 60_000;

/**
 * The review as one pull request comment: the marker, what the council found, a link to the full replay,
 * and every round folded when it fits. When it does not fit, the rounds are left to the replay.
 */
export function renderPrComment(r: SessionReplay, options: { top?: TopObjection[]; share?: string; replayUrl?: string; maxChars?: number; seats?: SeatLines } = {}): string {
  const max = options.maxChars ?? PR_COMMENT_MAX_CHARS;
  const full = `${PR_COMMENT_MARKER}\n${renderReplayMarkdown(r, options)}`;
  if (full.length <= max) return full;
  const compact = `${PR_COMMENT_MARKER}\n${renderReplayMarkdown(r, { ...options, rounds: false })}`;
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 200)}\n\n_Cut to fit a GitHub comment. The full replay has the rest._\n`;
}
