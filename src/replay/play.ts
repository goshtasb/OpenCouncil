import chalk from 'chalk';
import { SessionReplay, describeBlock, objectionHeadlines, responseHeadlines } from './session-replay.js';

type Seat = 'LEAD PM' | 'CHIEF ENGINEER' | 'CHIEF ARCHITECT' | 'HARNESS' | 'OPERATOR';
const COLOR: Record<Seat, (s: string) => string> = {
  'LEAD PM': chalk.bold.magenta,
  'CHIEF ENGINEER': chalk.bold.blue,
  'CHIEF ARCHITECT': chalk.bold.yellow,
  'HARNESS': chalk.bold.cyan,
  'OPERATOR': chalk.bold.green
};

export interface Beat { at?: number; seat: Seat; headline: string; lines: string[] }

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Strips the Markdown markers a terminal can't show. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}

function firstSentences(text: string, max = 220): string {
  const t = plain(text).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '...');
}

/** Finds the timeline offset of the first event matching a pattern, so beats show real elapsed time. */
function when(r: SessionReplay, pattern: RegExp): number | undefined {
  return r.events.find(e => pattern.test(e.text))?.offsetSeconds;
}

/** Turns a replay into the short story `council demo` plays: who said what, in order, with the verdicts. */
export function buildBeats(r: SessionReplay): Beat[] {
  const beats: Beat[] = [];
  beats.push({ seat: 'OPERATOR', headline: 'The task', lines: [firstSentences(r.task, 400)] });
  for (const round of r.rounds) {
    if (round.n === 1 && round.plan) {
      beats.push({ at: when(r, /Saved plan-v1\b/), seat: 'LEAD PM', headline: 'Wrote draft v1 of the PRD', lines: [] });
    }
    if (round.changes) {
      const answers = responseHeadlines(round.changes);
      beats.push({ at: when(r, new RegExp(`Saved plan-v${round.n}\\b`)), seat: 'LEAD PM', headline: `Revised the PRD to v${round.n}`, lines: answers.map(a => firstSentences(a, 160)) });
    }
    if (round.engineer) {
      const objections = objectionHeadlines(round.engineer.reply);
      const count = round.engineer.openObjections ?? objections.length;
      const lines: string[] = [];
      if (count === 0) lines.push('No open objections.');
      else objections.slice(0, Math.min(3, count)).forEach((o, i) => {
        lines.push(`${i + 1}. ${firstSentences(o.headline, 200)}`);
        if (i === 0 && o.evidence) lines.push(`   ${firstSentences(o.evidence, 260)}`);
      });
      beats.push({
        at: when(r, new RegExp(`Round ${round.n} finished`)), seat: 'CHIEF ENGINEER',
        headline: `Round ${round.n}: ${round.engineer.verdict || 'reviewed'}, ${count} open objection${count === 1 ? '' : 's'}`, lines
      });
    }
    if (round.architect) {
      const req = round.architect.concerns.filter(c => /REQUIRED/i.test(c.type)).length;
      const adv = round.architect.concerns.length - req;
      const lines = round.architect.concerns.slice(0, 2).map(c => `${c.type.toLowerCase()}: ${firstSentences(c.description, 170)}`);
      if (round.architect.concerns.length > 2) lines.push(`and ${round.architect.concerns.length - 2} more`);
      if (!round.architect.concerns.length && round.architect.summary) lines.push(firstSentences(round.architect.summary, 220));
      beats.push({
        at: r.events.filter(e => /Architecture review finished/.test(e.text))[r.rounds.filter(x => x.architect && x.n < round.n).length]?.offsetSeconds,
        seat: 'CHIEF ARCHITECT', headline: `Sign-off review of v${round.n}: ${round.architect.verdict || 'reviewed'}${round.architect.concerns.length ? ` (${req} required, ${adv} advisory)` : ''}`, lines
      });
    }
    if (round.signoff) {
      beats.push({
        at: when(r, /Council Lead sign-off/), seat: 'LEAD PM', headline: `Final sign-off on v${round.n}: ${round.signoff.verdict || 'signed'}`,
        lines: round.signoff.summary ? [firstSentences(round.signoff.summary, 220)] : []
      });
    }
  }
  if (r.prd?.sha256) {
    beats.push({
      at: when(r, /AWAITING_APPROVAL/), seat: 'HARNESS', headline: 'All three seats signed off on the same document',
      lines: [`PRD sha256 ${r.prd.sha256.slice(0, 8)}. Nothing is built until the operator types APPROVE ${r.prd.sha256.slice(0, 8)}.`]
    });
    if (r.events.some(e => /APPROVED/.test(e.text))) beats.push({ at: when(r, /Status changed to APPROVED/), seat: 'OPERATOR', headline: `APPROVE ${r.prd.sha256.slice(0, 8)}`, lines: [] });
  }
  if (r.stalled) {
    beats.push({ seat: 'HARNESS', headline: 'STALLED: the round budget ran out with objections still open', lines: ['No document reached the operator, so nothing was built. The last draft and the open objections were saved.'] });
  }
  if (r.commits) {
    beats.push({ at: when(r, /Status changed to IN_EXECUTION/), seat: 'CHIEF ENGINEER', headline: 'Implemented the approved PRD in an isolated clone', lines: r.commits.split('\n').map(l => l.trim()).filter(Boolean).reverse() });
  }
  if (r.verification) {
    const lines = r.verification.gates.map(g => {
      const counts = /# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/.exec(g.output);
      return `${g.name}: ${g.command}  ${g.passed ? 'PASS' : 'FAIL'}${counts ? ` (${counts[2]} of ${counts[1]} tests pass, ${counts[3]} fail)` : ''}`;
    });
    beats.push({ at: when(r, /Verification (passed|failed)/), seat: 'HARNESS', headline: `Ran the project's own gates: ${r.verification.passed ? 'PASS' : 'FAIL'}`, lines });
  }
  if (r.status === 'BLOCKED' && r.blockedReason) {
    beats.push({ at: when(r, /Status changed to BLOCKED/), seat: 'HARNESS', headline: 'Outcome: BLOCKED', lines: [describeBlock(r.blockedReason)] });
  } else if (!r.stalled) {
    beats.push({ seat: 'HARNESS', headline: `Outcome: ${r.status}`, lines: [] });
  }
  return beats;
}

export function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && (indent.length + line.length + 1 + w.length) > width) { out.push(indent + line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(indent + line);
  return out;
}

export interface PlayOptions { delayMs?: number; write?: (s: string) => void; width?: number; sleep?: (ms: number) => Promise<void> }

/** Prints the beats one at a time. delayMs 0 prints everything at once (used for pipes and tests). */
export async function playBeats(beats: Beat[], options: PlayOptions = {}): Promise<void> {
  const write = options.write || ((s: string) => process.stdout.write(s));
  const width = Math.max(50, Math.min(options.width || 100, 100));
  const sleep = options.sleep || ((ms: number) => new Promise<void>(res => setTimeout(res, ms)));
  const base = options.delayMs ?? 0;
  for (const beat of beats) {
    const time = beat.at !== undefined ? chalk.dim(clock(beat.at)) + '  ' : '       ';
    write(`${time}${COLOR[beat.seat](beat.seat.padEnd(16))} ${chalk.bold(beat.headline)}\n`);
    for (const l of beat.lines) {
      const indent = /^\s/.test(l) ? ' '.repeat(27) : ' '.repeat(24);
      write(wrap(l, width, indent).join('\n') + '\n');
    }
    write('\n');
    if (base > 0) {
      const words = beat.lines.join(' ').split(/\s+/).length;
      await sleep(Math.min(base * 4, base + words * 45));
    }
  }
}
