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
export function renderReplayMarkdown(r: SessionReplay, options: { top?: TopObjection[]; share?: string } = {}): string {
  const out: string[] = [];
  out.push(`## Council review: ${r.slug}`, '');
  const rounds = r.rounds.filter(x => x.engineer).length;
  const meaning = r.status === 'STALLED' ? ': the seats did not all sign off, so it would not ship as is' : r.status === 'AWAITING_APPROVAL' || r.status === 'APPROVED' ? ': all three seats signed off' : '';
  out.push(`Outcome: **${r.status}** after ${rounds} round${rounds === 1 ? '' : 's'}${meaning} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`, '');
  if (options.top && options.top.length) {
    out.push('### What the council found', '');
    options.top.forEach((o, i) => {
      out.push(`${i + 1}. **${o.headline.replace(/\*\*/g, '')}**${o.location ? ` (\`${o.location}\`)` : ''}  `);
      if (o.evidence && o.evidence !== o.headline) out.push(`   ${o.evidence.replace(/\n+/g, ' ')}`);
      out.push(`   _${o.seat}, round ${o.round}_`, '');
    });
  } else {
    out.push('The council raised no objections.', '');
  }
  out.push('### Every round', '');
  for (const round of r.rounds) {
    if (round.changes) out.push(details(`Lead PM: what changed in v${round.n}`, round.changes, 'markdown'));
    if (round.engineer) out.push(details(`Chief Engineer, round ${round.n}: ${round.engineer.verdict || 'review'}`, round.engineer.reply, 'markdown'));
    if (round.architect) out.push(details(`Chief Architect on v${round.n}: ${round.architect.verdict || 'review'}`, round.architect.reply, 'markdown'));
    if (round.signoff) out.push(details(`Lead PM sign-off on v${round.n}: ${round.signoff.verdict || ''}`, round.signoff.reply, 'markdown'));
  }
  if (r.prd) out.push(details('The PRD all three seats signed off', r.prd.text, 'markdown'));
  if (r.stalled) out.push(details('Stalled: last draft and open objections', r.stalled, 'markdown'));
  out.push('', '<details><summary>The task</summary>', '', quote(r.task), '', '</details>', '');
  if (options.share) out.push(`> ${options.share}`, '');
  out.push('<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>');
  return out.join('\n') + '\n';
}
