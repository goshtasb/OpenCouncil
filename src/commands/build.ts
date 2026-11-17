import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { reviewConfig } from '../review/quick-review.js';
import { describeLineup, formatChecks, lineupLines, preflight, readyProviders } from '../review/preflight.js';
import { findConfigFile, loadConfig } from '../config.js';
import { ProviderId } from '../setup.js';
import { resolveRepoRoot } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { describeSeatLogins } from '../utils/auth.js';
import { BuildEngine, BuildOutcome, MAX_RISK_ROUNDS } from '../engine/build.js';
import { SEAT_LABELS } from '../engine/seats.js';
import { CliContext, action } from './shared.js';

/** A branch-safe slug from the task's first words. */
export function buildSlug(task: string): string {
  const words = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 6);
  // Whole words only, at most 40 characters (a single long word is cut).
  while (words.length > 1 && words.join('-').length > 40) words.pop();
  return words.join('-').slice(0, 40) || 'build';
}

/** What the terminal shows when a build ends. */
export function buildSummaryLines(result: BuildOutcome): string[] {
  const tested = result.outcomes.filter(o => o.status === 'tested').length;
  const rejected = result.outcomes.filter(o => o.status === 'rejected').length;
  const took = `${Math.floor(result.seconds / 60) ? `${Math.floor(result.seconds / 60)} min ` : ''}${result.seconds % 60} s`;
  const lines: string[] = [];
  lines.push(result.outcome === 'DONE'
    ? `DONE in ${took}: ${result.risks.length} risk${result.risks.length === 1 ? '' : 's'} named, ${tested} now a passing test${rejected ? `, ${rejected} rejected with a quote` : ''}.`
    : `BLOCKED after ${took}: ${result.reason}`);
  const byId = new Map(result.outcomes.map(o => [o.id, o]));
  for (const r of result.risks) {
    const o = byId.get(r.id);
    const how = !o ? 'not checked' : o.status === 'tested' ? `test in ${o.files.join(', ')}` : o.status === 'rejected' ? `rejected, quoting ${o.source}` : `missing: ${o.reason}`;
    lines.push(`  ${r.id} ${r.vendor}: ${r.title}  (${how})`);
  }
  for (const g of result.gaps) lines.push(`  Gap: ${SEAT_LABELS[g.seat]}, round ${g.round}: ${g.reason}`);
  return lines;
}

export function registerBuildCommands(program: Command, ctx: CliContext): void {
  program
    .command('build [task...]')
    .description('One agent builds the task; Claude, Gemini and Grok then name what could still be wrong, and every risk they name becomes a test the build must pass before it is done. No debate, no deferring.')
    .option('-f, --task-file <path>', 'Read the task from a file')
    .option('--slug <slug>', 'Branch name after council/ (default: from the task)')
    .option('--risk-rounds <n>', `How many times the seats look for risks, 1 to ${MAX_RISK_ROUNDS} (default 1, or build.risk_rounds)`, (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN))
    .option('--pr', 'Push the branch and open a pull request when everything passes (uses your gh CLI)')
    .option('--no-branch', 'Do not copy the finished branch into this repository')
    .option('--no-check', 'Skip the setup check and treat every installed AI CLI as signed in')
    .action(action(async (taskWords: string[], options: { taskFile?: string; slug?: string; riskRounds?: number; pr?: boolean; branch: boolean; check: boolean }) => {
      const repo = resolveRepoRoot();
      if (!fs.existsSync(path.join(repo, '.git'))) throw new Error('council build runs inside a git repository with at least one commit.');
      const task = options.taskFile ? fs.readFileSync(options.taskFile, 'utf8') : taskWords.join(' ');
      if (!task.trim()) throw new Error('Give the task as words (council build "add rate limiting to login") or with --task-file.');
      if (options.riskRounds !== undefined && !(Number.isInteger(options.riskRounds) && options.riskRounds >= 1 && options.riskRounds <= MAX_RISK_ROUNDS)) {
        throw new Error(`--risk-rounds takes a whole number from 1 to ${MAX_RISK_ROUNDS}.`);
      }
      let checks = null;
      if (options.check) {
        logger.info('Setup check: asking each AI CLI for a one-word reply...');
        const models: Partial<Record<ProviderId, string>> = {};
        if (findConfigFile(repo)) for (const seat of Object.values(loadConfig(repo).seats)) if (!models[seat.provider as ProviderId]) models[seat.provider as ProviderId] = seat.model;
        checks = await preflight({ models: Object.keys(models).length ? models : undefined });
        formatChecks(checks).forEach(line => console.log(line));
      }
      const ready = new Set<string>(readyProviders(checks || await preflight({ ping: false })));
      const { config, gates, notes } = await reviewConfig(repo, 1, ready);
      if (findConfigFile(repo)) {
        // A project's own config decides whether a failed seat may move to another company (off unless it says so).
        const own = loadConfig(repo);
        config.council = { ...config.council, seat_failover: own.council.seat_failover ?? false, round_timeout_seconds: own.council.round_timeout_seconds, execution_timeout_seconds: own.council.execution_timeout_seconds };
      }
      if (options.riskRounds !== undefined) config.build = { ...config.build, risk_rounds: options.riskRounds };
      lineupLines({ seats: config.seats }, checks || undefined).forEach((line, i) => (i === 0 ? logger.info(`Seats: ${line}`) : logger.warn(line)));
      if (describeLineup(config.seats).singleVendor) logger.warn('Every seat is on one AI company. The risks are better when Claude, Gemini and Grok each look: `council doctor` shows what to install.');
      notes.forEach(n => logger.warn(n));
      describeSeatLogins(config.seats).warnings.forEach(w => logger.warn(w));
      if (gates?.test) logger.info(`Test command from ${gates.source}: ${gates.test}`);

      const engine = new BuildEngine(config, undefined, repo);
      const result = await engine.run(repo, { task, slug: options.slug || buildSlug(task), publish: !!options.pr, fetchBranch: options.branch });
      console.log('');
      buildSummaryLines(result).forEach((line, i) => console.log(i === 0 ? chalk.bold(line) : line));
      console.log('');
      if (result.prUrl) console.log(`Pull request: ${result.prUrl}`);
      if (result.localBranch) console.log(`Branch:       ${result.localBranch} (in this repository; your checkout was not touched)`);
      console.log(`Checkout:     ${result.worktree}`);
      console.log(`Report:       ${result.report}`);
      if (result.outcome !== 'DONE') process.exitCode = 2;
    }));
}
