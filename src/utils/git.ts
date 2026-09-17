import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execa('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

export async function getHeadSha(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function isRegisteredWorktree(repoPath: string, worktreePath: string): Promise<boolean> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
  const target = fs.realpathSync(worktreePath);
  return stdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .some(line => {
      const p = line.slice('worktree '.length);
      return fs.existsSync(p) && fs.realpathSync(p) === target;
    });
}

export async function createWorktree(repoPath: string, worktreePath: string, commitOrBranch: string): Promise<void> {
  await execa('git', ['worktree', 'prune'], { cwd: repoPath });
  if (fs.existsSync(worktreePath) && (await isRegisteredWorktree(repoPath, worktreePath))) {
    // Reset worktree to pristine state
    await execa('git', ['reset', '--hard', 'HEAD'], { cwd: worktreePath });
    await execa('git', ['clean', '-qfdx', '-e', 'node_modules', '-e', '.venv'], { cwd: worktreePath });
    await execa('git', ['checkout', '--quiet', '--detach', commitOrBranch], { cwd: worktreePath });
    return;
  }
  if (fs.existsSync(worktreePath)) {
    throw new Error(`${worktreePath} exists but is not a worktree of ${repoPath}. Remove it and retry.`);
  }
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await execa('git', ['worktree', 'add', '--quiet', '--detach', worktreePath, commitOrBranch], { cwd: repoPath });
}

export async function getOriginUrl(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function cloneForExecution(repoPath: string, targetPath: string, branch: string, baseSha: string): Promise<void> {
  if (fs.existsSync(targetPath)) {
    throw new Error(`Execution directory already exists: ${targetPath}. Remove it to start a fresh execution.`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // Clone the local repository so the base commit is available even if it was never pushed,
  // then point origin at the real remote so the branch can be pushed.
  await execa('git', ['clone', '--quiet', '--no-local', repoPath, targetPath]);
  const origin = await getOriginUrl(repoPath);
  if (origin) {
    await execa('git', ['remote', 'set-url', 'origin', origin], { cwd: targetPath });
  } else {
    await execa('git', ['remote', 'remove', 'origin'], { cwd: targetPath });
  }
  await execa('git', ['checkout', '--quiet', '-b', branch, baseSha], { cwd: targetPath });

  // Harness files live in the clone but must never be committed.
  const exclude = path.join(targetPath, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, '\nCOUNCIL_PACKET.md\nDONE.md\nBLOCKED.md\n', 'utf8');
}
