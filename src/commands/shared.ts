import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig } from '../types.js';
import { logger } from '../utils/logger.js';

export interface CliContext {
  repoRoot: string;
  config: CouncilConfig;
}

/**
 * A failed seat CLI's execa error repeats the whole command line, persona and standards included, before its output.
 * Name the CLI and keep the tail of what it printed, where the real reason is.
 */
export function briefError(err: any): string {
  const message = err?.message || String(err);
  if (typeof err?.command !== 'string' || err.command.length < 300 || err.exitCode === undefined) return message;
  const cli = err.command.split(' ')[0];
  const output = [err.stderr, err.stdout].filter((x: unknown) => typeof x === 'string' && x.trim()).join('\n').trim().split('\n');
  const tail = output.slice(-15).join('\n');
  return `${cli} exited with code ${err.exitCode}${tail ? `:\n${tail}` : ' and printed nothing.'}`;
}

export function action<T extends any[]>(fn: (...args: T) => Promise<void> | void) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: any) {
      logger.error(briefError(err));
      if (process.env.COUNCIL_DEBUG && err?.stack) console.error(err.stack);
      process.exitCode = 1;
    }
  };
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dest, f));
  }
}
