import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig } from '../types.js';
import { logger } from '../utils/logger.js';

export interface CliContext {
  repoRoot: string;
  config: CouncilConfig;
}

export function action<T extends any[]>(fn: (...args: T) => Promise<void> | void) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: any) {
      logger.error(err?.message || String(err));
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
