import { execFileSync } from 'child_process';
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
  return process.env.COUNCILMEN_HOME || path.join(os.homedir(), '.councilmen');
}

// Harness state is kept outside the repository (so it never dirties git status),
// namespaced per repository so backlogs and sessions of different projects never mix.
export function projectStateDir(repoRoot: string = resolveRepoRoot()): string {
  const abs = path.resolve(repoRoot);
  const key = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 8);
  return path.join(councilHome(), 'projects', `${path.basename(abs)}-${key}`);
}
