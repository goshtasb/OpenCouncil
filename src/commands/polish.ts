import { Command } from 'commander';
import * as fs from 'fs';
import chalk from 'chalk';
import { getAdapter } from '../adapters/registry.js';
import { DEFAULT_MODELS, ProviderId } from '../setup.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_POLISH_CRITICS, DEFAULT_POLISH_MERGER, PolishSeat, plannedCalls, runPolish, seatName } from '../polish/polish.js';
import { action, readStdin } from './shared.js';

/** "claude-code", "grok-cli=grok-4.6" -> a seat; a bare provider gets its default model. */
export function parseSeat(spec: string): PolishSeat {
  const [provider, model] = spec.trim().split('=').map(s => s.trim());
  if (!provider) throw new Error(`"${spec}" is not a seat. Use a provider such as claude-code, antigravity or grok-cli, optionally with =model.`);
  getAdapter(provider); // throws with the list of providers when it is unknown
  return { provider, model: model || DEFAULT_MODELS[provider as ProviderId] };
}

export function parseSeats(list: string): PolishSeat[] {
  return list.split(',').filter(s => s.trim()).map(parseSeat);
}

export function registerPolishCommands(program: Command): void {
  program
    .command('polish [idea...]')
    .description('Polish an idea: Claude, Gemini and Grok each critique it blind, then Claude merges the best of them into one version and keeps their disagreements. No debate rounds. Nothing but the idea is sent, and no repository is needed.')
    .option('-f, --file <path>', 'Read the idea from this file (or pipe it on stdin)')
    .option('--rebuttal', 'Then give each critic one reply to the merged version (one more call per critic)')
    .option('--critics <list>', `Comma-separated critics, each provider[=model] (default ${DEFAULT_POLISH_CRITICS.map(s => s.provider).join(',')})`)
    .option('--merger <seat>', `Who merges, provider[=model] (default ${DEFAULT_POLISH_MERGER.provider}=${DEFAULT_POLISH_MERGER.model})`)
    .option('-o, --out <dir>', 'Write polish.md and polish.json here (default ~/.council/polish/<id>/)')
    .action(action(async (words: string[], options: { file?: string; rebuttal?: boolean; critics?: string; merger?: string; out?: string }) => {
      let idea = words.join(' ').trim();
      if (!idea && options.file) idea = fs.readFileSync(options.file, 'utf8');
      if (!idea) idea = await readStdin();
      const wanted = options.critics ? parseSeats(options.critics) : DEFAULT_POLISH_CRITICS;
      const merger = options.merger ? parseSeat(options.merger) : DEFAULT_POLISH_MERGER;
      // Only a version check, no model call: a critic whose CLI is missing is dropped before anything runs.
      const critics: PolishSeat[] = [];
      for (const seat of wanted) {
        if (await getAdapter(seat.provider).isAvailable()) critics.push(seat);
        else logger.warn(`${seatName(seat)} is not installed, so it sits this one out.`);
      }
      if (!critics.length) throw new Error('None of the critics\' CLIs is installed. `council doctor` says how to install and sign in to each.');
      if (!(await getAdapter(merger.provider).isAvailable())) throw new Error(`${seatName(merger)} merges the critiques, and its CLI is not installed.`);
      logger.info(`Critics: ${critics.map(seatName).join(', ')}. Merger: ${seatName(merger)}. ${plannedCalls(critics.length, !!options.rebuttal)} model calls on your own CLIs' plans.`);
      const result = await runPolish(idea, { critics, merger, rebuttal: !!options.rebuttal, outDir: options.out, onProgress: line => logger.info(line) });
      console.log('');
      console.log(chalk.bold(`Done in ${result.seconds} s, ${result.calls} calls.`));
      result.gaps.forEach(g => logger.warn(g));
      console.log('');
      console.log(fs.readFileSync(result.mdPath, 'utf8').split('\n## Who was who')[0].trim());
      console.log('');
      console.log(`Full write-up, with who was who and each critique: ${result.mdPath}`);
    }));
}
