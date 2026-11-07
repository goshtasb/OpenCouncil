import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { REVIEW_ROUNDS, reviewConfig, runReview } from '../review/quick-review.js';
import { resolveRepoRoot } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { SessionManager } from '../engine/session.js';
import { printArchitectReview } from './council.js';
import { CliContext, action } from './shared.js';

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

export function registerReviewCommands(program: Command, ctx: CliContext): void {
  program
    .command('review [task...]')
    .description('Have the council tear into your current change (or a one-line plan) and get a page of its objections. No setup; nothing in your repo is written or run.')
    .option('--base <ref>', 'Review the commits ahead of this ref instead of uncommitted changes (default: uncommitted, else ahead of origin/main)')
    .option('--rounds <n>', `Round budget (default ${REVIEW_ROUNDS})`, (v: string) => parseInt(v, 10))
    .option('-o, --out <dir>', 'Also copy review.html and review.md into this directory')
    .option('--no-open', 'Do not open the page in a browser when it is done')
    .action(action(async (taskWords: string[], options: { base?: string; rounds?: number; out?: string; open: boolean }) => {
      // Before 0.3 `council review <session>` ran the Chief Architect's review of a session. Keep that working.
      if (isSessionId(taskWords)) {
        logger.warn('`council review <session>` is now `council architect-review <session>`. Running that.');
        await printArchitectReview(ctx.config, taskWords[0]);
        return;
      }
      const repo = resolveRepoRoot();
      if (!fs.existsSync(path.join(repo, '.git'))) {
        throw new Error('council review runs inside a git repository. cd into one, or run `git init` and commit first.');
      }
      const task = taskWords.join(' ').trim() || undefined;
      const { config, plan, gates } = await reviewConfig(repo, options.rounds || REVIEW_ROUNDS);
      if (plan) logger.info(`Seats (${plan.mode}): ${Object.entries(plan.seats).map(([seat, p]) => `${seat} ${p.provider}/${p.model}`).join(', ')}`);
      if (gates && gates.test) logger.info(`Gates from ${gates.source}: ${[gates.test, gates.lint].filter(Boolean).join(', ')} (read by the seats, not run)`);
      const result = await runReview(repo, {
        task, base: options.base, config,
        onSession: (id, mode, change) => {
          const what = mode === 'task' ? `the plan "${task}"` : mode === 'uncommitted' ? `your uncommitted change (${change!.files.length} file${change!.files.length === 1 ? '' : 's'})` : `${change!.files.length} file${change!.files.length === 1 ? '' : 's'} changed since ${change!.base}`;
          logger.info(`Session ${id}: the council is reviewing ${what}. This takes a few minutes.`);
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
      const mins = Math.floor(result.seconds / 60);
      console.log('');
      console.log(chalk.bold(`The council ${result.outcome === 'STALLED' ? 'could not agree' : 'signed off'} after ${result.rounds} round${result.rounds === 1 ? '' : 's'} (${mins ? `${mins} min ` : ''}${result.seconds % 60} s).`));
      if (result.top.length) {
        console.log(chalk.bold('\nWhat it found:'));
        result.top.forEach((o, i) => console.log(`  ${i + 1}. ${o.headline.replace(/\*\*/g, '')}${o.location ? chalk.dim(` (${o.location})`) : ''}\n     ${chalk.dim(`${o.seat}, round ${o.round}`)}`));
      } else {
        console.log('\nThe council raised no objections.');
      }
      console.log(chalk.bold('\nShare it:'));
      console.log(`  ${result.share}`);
      console.log(`\nPage:     ${html}\nMarkdown: ${md} ${chalk.dim('(paste into a gist or a PR comment)')}`);
      console.log(chalk.dim('Nothing in your repo was changed, executed or committed. `council init` sets up the full loop, where the council also builds it and runs your gates.'));
      if (options.open && process.stdout.isTTY) openInBrowser(html);
    }));
}
