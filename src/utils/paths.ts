import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

export function resolveRepoRoot(dir: string = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return path.resolve(dir);
  }
}

export function councilHome(): string {
  // COUNCILMEN_HOME and ~/.councilmen are the pre-rename names, still honoured so existing
  // sessions and backlogs are not orphaned. Remove once nobody is carrying them.
  if (process.env.COUNCIL_HOME) return process.env.COUNCIL_HOME;
  if (process.env.COUNCILMEN_HOME) return process.env.COUNCILMEN_HOME;
  const current = path.join(os.homedir(), '.council');
  const legacy = path.join(os.homedir(), '.councilmen');
  if (!fs.existsSync(current) && fs.existsSync(legacy)) return legacy;
  return current;
}

// Harness state is kept outside the repository (so it never dirties git status),
// namespaced per repository so backlogs and sessions of different projects never mix.
export function projectStateDir(repoRoot: string = resolveRepoRoot()): string {
  const abs = path.resolve(repoRoot);
  const key = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 8);
  return path.join(councilHome(), 'projects', `${path.basename(abs)}-${key}`);
}
