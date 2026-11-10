import { ReviewVerdict, SessionReplay, TopObjection } from './session-replay.js';

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

/** What to say when the found list is empty: no objection at all, every one overruled, or a verdict with nothing readable to list. */
export function nothingFoundText(r: Pick<SessionReplay, 'rounds'>, verdict?: ReviewVerdict): string {
  if (verdict?.verdict === 'NO VERDICT') return 'No seat reviewed the change, so the council has nothing to report. The rounds below show what each seat returned.';
  if (verdict && verdict.verdict !== 'PASS') return `The review did not pass (${verdict.summary}), but its objections could not be read one by one. Every round below has them in full.`;
  const n = allOverruled(r);
  return n ? `The Chief Engineer raised ${n} objection${n === 1 ? '' : 's'} and the Chief Architect overruled ${n === 1 ? 'it' : 'every one'}, so none stands.` : 'The council raised no objections.';
}

/** How a found-list entry says what the Chief Architect made of it. */
export function rulingNote(o: TopObjection): string {
  if (o.state === 'minor') return o.seat === 'Chief Architect' ? 'advisory, does not block' : 'the Chief Architect ruled it minor: right, but it does not block';
  if (o.state === 'resolved') return 'settled in a later round';
  return o.ruling === 'STANDS' ? 'upheld by the Chief Architect' : o.ruling === 'MEASURE' ? 'the Chief Architect asked for a measurement' : '';
}

export function renderReplayMarkdown(r: SessionReplay, options: { top?: TopObjection[]; share?: string; replayUrl?: string; rounds?: boolean; seats?: SeatLines; verdict?: ReviewVerdict } = {}): string {
  const out: string[] = [];
  out.push(`## Council review: ${r.slug}`, '');
  const rounds = r.rounds.filter(x => x.engineer).length;
  // Only when nothing made the found list: in a debate, an earlier round's upheld objection still stands.
  const overruled = options.top && options.top.length ? 0 : allOverruled(r);
  const meaning = r.status === 'STALLED' && overruled ? `: no objection stands (the Chief Architect overruled ${overruled === 1 ? 'the only one' : `all ${overruled}`}), but nothing was signed off` : r.status === 'STALLED' ? ': the seats did not all sign off, so it would not ship as is' : r.status === 'AWAITING_APPROVAL' || r.status === 'APPROVED' ? ': all three seats signed off' : '';
  const v = options.verdict;
  out.push(v
    ? `Outcome: **${v.verdict}** after ${rounds} round${rounds === 1 ? '' : 's'}: ${v.summary} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`
    : `Outcome: **${r.status}** after ${rounds} round${rounds === 1 ? '' : 's'}${meaning} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`, '');
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
      const note = rulingNote(o);
      out.push(`   _${o.seat}, round ${o.round}${note ? `; ${note}` : ''}_`, '');
    });
  } else {
    out.push(nothingFoundText(r, v), '');
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
    if (r.stalled) out.push(details(v ? 'The last draft and the objections still open' : 'Stalled: last draft and open objections', r.stalled, 'markdown'));
    out.push('', '<details><summary>The task</summary>', '', quote(r.task), '', '</details>', '');
  }
  if (options.share) out.push(`> ${options.share}`, '');
  out.push('<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>');
  return out.join('\n') + '\n';
}

/** "2 upheld, 1 overruled" from a round's rulings. */
export function rulingCounts(rulings: Array<{ ruling: string }>): string {
  const n = (r: string) => rulings.filter(x => x.ruling === r).length;
  const parts = [[n('STANDS'), 'upheld'], [n('MINOR'), 'minor'], [n('OVERRULED'), 'overruled'], [n('MEASURE'), 'to measure']].filter(([c]) => c).map(([c, w]) => `${c} ${w}`);
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
export function renderPrComment(r: SessionReplay, options: { top?: TopObjection[]; share?: string; replayUrl?: string; maxChars?: number; seats?: SeatLines; verdict?: ReviewVerdict } = {}): string {
  const max = options.maxChars ?? PR_COMMENT_MAX_CHARS;
  const full = `${PR_COMMENT_MARKER}\n${renderReplayMarkdown(r, options)}`;
  if (full.length <= max) return full;
  const compact = `${PR_COMMENT_MARKER}\n${renderReplayMarkdown(r, { ...options, rounds: false })}`;
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 200)}\n\n_Cut to fit a GitHub comment. The full replay has the rest._\n`;
}
