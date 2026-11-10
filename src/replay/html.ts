import { SessionReplay, TopObjection } from './session-replay.js';
import { escapeHtml, renderMarkdown } from './markdown.js';
import { SeatLines, allOverruled, nothingFoundText, rulingCounts } from './markdown-replay.js';

const SEATS = {
  pm: { name: 'Lead PM', cls: 'pm' },
  eng: { name: 'Chief Engineer', cls: 'eng' },
  arch: { name: 'Chief Architect', cls: 'arch' },
  harness: { name: 'Harness', cls: 'harness' }
} as const;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function seatBlock(seat: keyof typeof SEATS, title: string, body: string, verdict?: string): string {
  const s = SEATS[seat];
  const badge = verdict ? ` <span class="verdict ${/SHIP IT|^SIGN-OFF$|PASS/.test(verdict) ? 'ok' : /CONCERN|CHANGES/.test(verdict) ? 'warn' : 'bad'}">${escapeHtml(verdict)}</span>` : '';
  return `<section class="seat ${s.cls}"><header><span class="who">${s.name}</span> ${escapeHtml(title)}${badge}</header><div class="md">${body}</div></section>`;
}

function fold(summary: string, inner: string): string {
  return `<details><summary>${escapeHtml(summary)}</summary>${inner}</details>`;
}

const renderInline = (text: string) => renderMarkdown(text).replace(/^<p>|<\/p>$/g, '');

const pre = (text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`;

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e1da;--card:#fff;--code:#f3f1ea;
--pm:#8a3ffc;--eng:#0f62fe;--arch:#b28600;--harness:#007d79;--ok:#198038;--warn:#b28600;--bad:#da1e28}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#f2f2f2;--muted:#a8a8a8;--line:#393939;--card:#1f1f1f;--code:#262626;
--pm:#be95ff;--eng:#78a9ff;--arch:#f1c21b;--harness:#3ddbd9;--ok:#42be65;--warn:#f1c21b;--bad:#ff8389}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:880px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;line-height:1.2;margin:0 0 8px}
h2{font-size:20px;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line)}h4,h5,h6{font-size:16px;margin:16px 0 6px}
.lede{color:var(--muted);margin:0 0 4px}.outcome{display:inline-block;margin:12px 0;padding:4px 10px;border-radius:999px;font-weight:600;border:1px solid currentColor}
.outcome.ok{color:var(--ok)}.outcome.bad{color:var(--bad)}.outcome.warn{color:var(--warn)}
.seat{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;margin:14px 0;padding:12px 16px}
.seat header{font-weight:600;margin-bottom:6px}.seat .who{color:var(--c)}.pm{--c:var(--pm)}.eng{--c:var(--eng)}.arch{--c:var(--arch)}.harness{--c:var(--harness)}
.verdict{font-size:13px;font-weight:600;padding:1px 8px;border-radius:999px;margin-left:6px;border:1px solid currentColor}
.verdict.ok{color:var(--ok)}.verdict.warn{color:var(--warn)}.verdict.bad{color:var(--bad)}
code{font:13.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code);padding:12px;border-radius:6px;overflow-x:auto}pre code{padding:0;background:none;overflow-wrap:normal}
blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--line);color:var(--muted)}
.table{overflow-x:auto}table{border-collapse:collapse;margin:8px 0;font-size:14px}th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
details{margin:10px 0}summary{cursor:pointer;color:var(--muted);font-weight:600}details[open]>summary{margin-bottom:8px}
.timeline td:first-child{font-family:ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
h2+.seat{margin-top:8px}.share{margin:20px 0;padding:12px 16px;border:1px dashed var(--line);border-radius:8px}.share .label{font-weight:600;margin-bottom:6px}
.share textarea{width:100%;font:14px/1.45 ui-monospace,Menlo,monospace;background:var(--code);color:var(--fg);border:0;border-radius:6px;padding:8px;resize:vertical}
footer{margin-top:48px;color:var(--muted);font-size:14px}a{color:var(--eng)}
`;

/** One self-contained HTML page for a session: no scripts, no external requests, every seat reply rendered from its file. */
export function renderReplayHtml(r: SessionReplay, options: { note?: string; top?: TopObjection[]; share?: string; seats?: SeatLines } = {}): string {
  const outcomeClass = r.status === 'DONE' || r.status === 'MERGED' ? 'ok' : r.status === 'BLOCKED' || r.status === 'STALLED' ? 'bad' : 'warn';
  const parts: string[] = [];
  parts.push(`<h1>Council replay: ${escapeHtml(r.slug)}</h1>`);
  parts.push(`<p class="lede">Session <code>${escapeHtml(r.id)}</code>, ${escapeHtml(r.profile)} profile, base commit <code>${escapeHtml(r.baseSha.slice(0, 7))}</code>, ` +
    `round budget ${r.maxRounds}${r.signoffRevisions ? ` plus ${r.signoffRevisions} sign-off revision` : ''}.</p>`);
  parts.push(`<span class="outcome ${outcomeClass}">Outcome: ${escapeHtml(r.status)}</span>`);
  if (options.seats?.lineup) parts.push(`<p class="lede"><strong>Seats:</strong> ${escapeHtml(options.seats.lineup)}</p>`);
  if (options.seats?.gaps.length) parts.push(seatBlock('harness', 'gaps in this review', `<ul>${options.seats.gaps.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul>`));
  if (options.note) parts.push(`<div class="md">${renderMarkdown(options.note)}</div>`);
  if (options.top && options.top.length) {
    parts.push('<h2>What the council found</h2>' + options.top.map((o, i) =>
      seatBlock(o.seat === 'Chief Engineer' ? 'eng' : 'arch', `objection ${i + 1}, round ${o.round}${o.location ? ` · ${o.location}` : ''}${o.ruling === 'STANDS' ? ' · upheld by the Chief Architect' : o.ruling === 'MEASURE' ? ' · to measure' : ''}`,
        `<p><strong>${renderInline(o.headline)}</strong></p>${o.evidence && o.evidence !== o.headline ? `<p>${renderInline(o.evidence)}</p>` : ''}`)).join(''));
  } else if (options.top && allOverruled(r)) {
    parts.push(`<h2>What the council found</h2><p>${escapeHtml(nothingFoundText(r))}</p>`);
  }
  if (options.share) {
    parts.push(`<div class="share"><div class="label">Share it</div><textarea readonly rows="3" aria-label="Share line">${escapeHtml(options.share)}</textarea></div>`);
  }
  parts.push('<p class="lede">Every seat reply below is the text the harness saved, rendered as written. Nothing is summarised.</p>');

  parts.push('<h2>The task</h2>' + `<blockquote>${renderMarkdown(r.task)}</blockquote>`);

  if (r.events.length) {
    parts.push('<h2>Timeline</h2><div class="table"><table class="timeline"><tbody>' +
      r.events.map(e => `<tr><td>${clock(e.offsetSeconds)}</td><td>${escapeHtml(e.text)}</td></tr>`).join('') + '</tbody></table></div>');
  }

  if (r.rulings.length) {
    parts.push('<h2>Binding rulings from the Chief Architect</h2>' + r.rulings.map(ru =>
      seatBlock('arch', `ruling ${ru.id ?? ''}${ru.askedBy ? `, asked by ${ru.askedBy}` : ''}`,
        `<p><strong>Q:</strong> ${escapeHtml(ru.question)}</p><p><strong>Ruling:</strong> ${escapeHtml(ru.ruling)}</p>`)).join(''));
  }

  for (const round of r.rounds) {
    parts.push(`<h2>Round ${round.n}</h2>`);
    if (round.changes) parts.push(seatBlock('pm', `what changed in draft v${round.n}`, renderMarkdown(round.changes)));
    if (round.plan) parts.push(fold(round.n === 1 ? 'Lead PM: draft v1 (full text)' : `Draft v${round.n} (full text)`, `<div class="md">${renderMarkdown(round.plan)}</div>`));
    if (round.engineer) {
      const count = typeof round.engineer.openObjections === 'number' ? `, ${round.engineer.openObjections} open objection${round.engineer.openObjections === 1 ? '' : 's'}` : '';
      parts.push(seatBlock('eng', `review of v${round.n}${count}`, renderMarkdown(round.engineer.reply), round.engineer.verdict));
    }
    if (round.tiebreak) parts.push(seatBlock('arch', `rulings on round ${round.n}: ${rulingCounts(round.tiebreak.rulings)}`, renderMarkdown(round.tiebreak.reply)));
    if (round.architect) parts.push(seatBlock('arch', `sign-off review of v${round.n}`, renderMarkdown(round.architect.reply), round.architect.verdict));
    if (round.signoff) parts.push(seatBlock('pm', `final sign-off on v${round.n}`, renderMarkdown(round.signoff.reply), round.signoff.verdict));
  }

  if (r.prd) {
    parts.push('<h2>The signed-off PRD</h2>' +
      (r.prd.sha256 ? `<p>SHA-256 <code>${escapeHtml(r.prd.sha256)}</code>. The operator approves this exact document with <code>APPROVE ${escapeHtml(r.prd.sha256.slice(0, 8))}</code>.</p>` : '') +
      fold('Final PRD (full text)', `<div class="md">${renderMarkdown(r.prd.text)}</div>`));
  }
  if (r.stalled) {
    parts.push('<h2>Stalled: what the harness kept</h2><p>No document reached the operator. The harness saved the last draft and the open objections instead.</p>' +
      fold('stalled-draft-and-objections.md', `<div class="md">${renderMarkdown(r.stalled)}</div>`));
  }
  if (r.verification) {
    const v = r.verification;
    parts.push(`<h2>Verification gates</h2><p>Run on <code>${escapeHtml(v.headSha.slice(0, 7))}</code>. Overall: <strong>${v.passed ? 'PASS' : 'FAIL'}</strong>.</p>` +
      v.gates.map(g => seatBlock('harness', `gate ${g.name}: ${g.command}${g.durationMs !== undefined ? `, ${(g.durationMs / 1000).toFixed(1)} s` : ''}`,
        fold('Output', pre(g.output.slice(-6000))), g.passed ? 'PASS' : 'FAIL')).join(''));
  }
  if (r.commits) {
    parts.push('<h2>What the Chief Engineer committed</h2>' + pre(r.commits) + (r.diff ? fold('Full diff', pre(r.diff)) : ''));
  }
  if (r.blockedReason) parts.push('<h2>Why it ended BLOCKED</h2>' + pre(r.blockedReason.slice(0, 3000)));

  parts.push('<footer>Made with <a href="https://github.com/goshtasb/OpenCouncil" rel="noopener noreferrer">Open Council</a> by <code>council replay</code>.</footer>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Council replay: ${escapeHtml(r.slug)}</title>
<style>${CSS}</style>
</head>
<body><main>
${parts.join('\n')}
</main></body>
</html>
`;
}
