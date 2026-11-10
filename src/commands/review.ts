import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { spawn, spawnSync } from 'child_process';
import { REVIEW_DEBATE_ROUNDS, REVIEW_MAX_ROUNDS, REVIEW_MIN_ROUNDS, REVIEW_ROUNDS, ReviewResult, reviewConfig, runReview } from '../review/quick-review.js';
import { describeLineup, formatChecks, lineupLines, preflight, readyProviders } from '../review/preflight.js';
import { findConfigFile, loadConfig } from '../config.js';
import { ProviderId } from '../setup.js';
import { nothingFoundText, rulingNote } from '../replay/markdown-replay.js';
import { resolveRepoRoot } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { SessionManager } from '../engine/session.js';
import { printArchitectReview } from './council.js';
import { CliContext, action } from './shared.js';
import { describeSeatLogins } from '../utils/auth.js';
import { renderPrComment } from '../replay/markdown-replay.js';

function openInBrowser(file: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => { /* no opener on this machine: the path is printed anyway */ });
    child.unref();
  } catch { /* ignore */ }
}

function isSessionId(words: string[]): boolean {
  if (words.length !== 1 || !/^\d{14}-/.test(words[0])) return false;
  try { new SessionManager().loadMeta(words[0]); return true; } catch { return false; }
}

/** Puts review.md in a secret GitHub gist with the user's own gh CLI and returns its URL, or null with the reason printed. */
function createGist(mdPath: string): string | null {
  const r = spawnSync('gh', ['gist', 'create', '--desc', 'Open Council review', mdPath], { encoding: 'utf8' });
  if (r.error) { logger.warn('--gist needs the GitHub CLI (gh). The Markdown is still on disk.'); return null; }
  if (r.status !== 0) { logger.warn(`gh gist create failed: ${(r.stderr || '').trim().split('\n').pop()}`); return null; }
  return (r.stdout || '').trim().split('\n').pop() || null;
}

/** The models a project's .council/config.yml sets, per provider, so the setup check asks the ones the review will use. */
function configuredModels(repo: string): Partial<Record<ProviderId, string>> | undefined {
  if (!findConfigFile(repo)) return undefined;
  const models: Partial<Record<ProviderId, string>> = {};
  for (const seat of Object.values(loadConfig(repo).seats)) if (seat.model && !models[seat.provider as ProviderId]) models[seat.provider as ProviderId] = seat.model;
  return models;
}

/** The one bold line under a review: the verdict, how long it took, and what it rests on. */
export function outcomeLine(result: Pick<ReviewResult, 'verdict' | 'rounds'>, took: string, singleVendor: boolean): string {
  const rounds = `${result.rounds} round${result.rounds === 1 ? '' : 's'}`;
  return `${result.verdict.verdict} after ${rounds} (${took}${singleVendor ? ', all on one vendor' : ''}): ${result.verdict.summary}.`;
}

export function registerReviewCommands(program: Command, ctx: CliContext): void {
  program
    .command('review [task...]')
    .description('Have the council tear into your current change (or a one-line plan) and get a page of its objections. Checks which AIs are signed in first and runs with those; nothing in your repo is written or run.')
    .option('--base <ref>', 'Review the commits ahead of this ref instead of uncommitted changes (default: uncommitted, else ahead of origin/main)')
    .option('--debate', `Full debate: the Lead PM answers the objections and the seats argue for ${REVIEW_DEBATE_ROUNDS} rounds instead of 1 (slower, uses more of each plan)`)
    .option('--rounds <n>', `Round budget, ${REVIEW_MIN_ROUNDS} to ${REVIEW_MAX_ROUNDS} (default ${REVIEW_ROUNDS}, or ${REVIEW_DEBATE_ROUNDS} with --debate)`, (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN))
    .option('--no-check', 'Skip the setup check and treat every installed AI CLI as signed in')
    .option('-o, --out <dir>', 'Also copy review.html and review.md into this directory')
    .option('--gist', 'Also put review.md in a secret GitHub gist (uses your gh CLI) and print its link')
    .option('--comment <file>', 'Also write the review as one pull request comment (Markdown, under GitHub\'s size limit) to this file')
    .option('--replay-url <url>', 'With --comment: the link the comment gives for the full replay')
    .option('--no-open', 'Do not open the page in a browser when it is done')
    .action(action(async (taskWords: string[], options: { base?: string; rounds?: number; debate?: boolean; check: boolean; out?: string; gist?: boolean; comment?: string; replayUrl?: string; open: boolean }) => {
      // Before 0.3 `council review <session>` ran the Chief Architect's review of a session. Keep that working.
      if (isSessionId(taskWords)) {
        console.error('⚠ `council review <session>` is now `council architect-review <session>`, and the old form goes away in 0.4.0. Running that.');
        await printArchitectReview(ctx.config, taskWords[0]);
        return;
      }
      const repo = resolveRepoRoot();
      if (!fs.existsSync(path.join(repo, '.git'))) {
        throw new Error('council review runs inside a git repository. cd into one, or run `git init` and commit first.');
      }
      const task = taskWords.join(' ').trim() || undefined;
      const rounds = options.rounds === undefined ? (options.debate ? REVIEW_DEBATE_ROUNDS : REVIEW_ROUNDS) : options.rounds;
      let checks = null;
      if (options.check) {
        logger.info('Setup check: asking each AI CLI for a one-word reply...');
        checks = await preflight({ models: configuredModels(repo) });
        formatChecks(checks).forEach(line => console.log(line));
      }
      // With --no-check every installed CLI counts as ready, so config seats on a missing CLI still move up front.
      const ready = new Set<string>(readyProviders(checks || await preflight({ ping: false })));
      const { config, gates, notes } = await reviewConfig(repo, rounds, ready);
      const lineup = describeLineup(config.seats);
      lineupLines({ seats: config.seats }, checks || undefined).forEach((line, i) => (i === 0 ? logger.info(`Seats: ${line}`) : logger.warn(line)));
      notes.forEach(n => logger.warn(n));
      const logins = describeSeatLogins(config.seats);
      logger.info(`Logins: ${logins.lines.join('; ')}`);
      logins.warnings.forEach(w => logger.warn(w));
      if (gates && gates.test) logger.info(`Gates from ${gates.source}: ${[gates.test, gates.lint].filter(Boolean).join(', ')} (read by the seats, not run)`);
      const result = await runReview(repo, {
        task, base: options.base, config,
        onSession: (id, mode, change) => {
          const what = mode === 'task' ? `the plan "${task}"` : mode === 'uncommitted' ? `your uncommitted change (${change!.files.length} file${change!.files.length === 1 ? '' : 's'})` : `${change!.files.length} file${change!.files.length === 1 ? '' : 's'} changed since ${change!.base}`;
          logger.info(`Session ${id}: the council is reviewing ${what}. ${rounds === 1 ? 'Quick review: one round, one call per seat.' : `Debate: up to ${rounds} rounds; this takes a few minutes.`}`);
          if (change) {
            logger.info(`Sent to the seats' providers: the diff of ${change.files.join(', ')}`);
            if (change.withheld.length) logger.warn(`Not sent, because they look like secrets: ${change.withheld.join(', ')}`);
          }
        }
      });
      let html = result.htmlPath;
      let md = result.mdPath;
      if (options.out) {
        fs.mkdirSync(options.out, { recursive: true });
        html = path.join(options.out, 'review.html');
        md = path.join(options.out, 'review.md');
        fs.copyFileSync(result.htmlPath, html);
        fs.copyFileSync(result.mdPath, md);
      }
      if (options.comment) {
        fs.mkdirSync(path.dirname(path.resolve(options.comment)), { recursive: true });
        fs.writeFileSync(options.comment, renderPrComment(result.replay, { top: result.top, share: result.share, replayUrl: options.replayUrl, seats: result.seats, verdict: result.verdict }), 'utf8');
      }
      const mins = Math.floor(result.seconds / 60);
      console.log('');
      const took = `${mins ? `${mins} min ` : ''}${result.seconds % 60} s`;
      console.log(chalk.bold(outcomeLine(result, took, lineup.singleVendor)));
      if (result.seats.gaps.length) {
        console.log(chalk.bold('\nGaps in this review:'));
        result.seats.gaps.forEach(g => console.log(`  - ${g}`));
      }
      if (result.top.length) {
        console.log(chalk.bold(`\nWhat it found${result.top.length > 3 ? ` (top 3 of ${result.top.length} on the page)` : ''}:`));
        result.top.slice(0, 3).forEach((o, i) => console.log(`  ${i + 1}. ${o.headline.replace(/\*\*/g, '')}${o.location ? chalk.dim(` (${o.location})`) : ''}\n     ${chalk.dim(`${o.seat}, round ${o.round}${rulingNote(o) ? `, ${rulingNote(o)}` : ''}`)}`));
      } else {
        console.log(`\n${nothingFoundText(result.replay)}`);
      }
      console.log(chalk.bold('\nShare it:'));
      console.log(`  ${result.share}`);
      console.log(`\nPage:     ${html}\nMarkdown: ${md} ${chalk.dim('(paste into a gist or a PR comment)')}`);
      if (options.comment) console.log(`Comment:  ${options.comment}`);
      if (options.gist) {
        const url = createGist(md);
        if (url) console.log(`Gist:     ${url}`);
      }
      console.log(chalk.dim('Nothing in your repo was changed, executed or committed. `council init` sets up the full loop, where the council also builds it and runs your gates.'));
      if (options.open && process.stdout.isTTY) openInBrowser(html);
    }));
}
