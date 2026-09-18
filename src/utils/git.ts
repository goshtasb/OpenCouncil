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

export type BaseSyncResult = { ok: true; merged: boolean; baseSha?: string } | { ok: false; reason: string };

/**
 * Merges the current tip of the base branch into the execution branch before verification, so the
 * gates run on what would actually land. Verifying the branch alone can pass code that fails to
 * build once merged (observed: a signature change that compiled alone but not against a newer base).
 */
export async function syncWithBase(cwd: string, baseBranch: string): Promise<BaseSyncResult> {
  const origin = await getOriginUrl(cwd);
  if (!origin) return { ok: true, merged: false };
  try {
    await execa('git', ['fetch', '--quiet', 'origin', baseBranch], { cwd });
  } catch (err: any) {
    return { ok: true, merged: false }; // base branch not on the remote yet: nothing to merge
  }
  const { stdout: baseSha } = await execa('git', ['rev-parse', `origin/${baseBranch}`], { cwd });
  const behind = await execa('git', ['merge-base', '--is-ancestor', baseSha.trim(), 'HEAD'], { cwd, reject: false });
  if (behind.exitCode === 0) return { ok: true, merged: false, baseSha: baseSha.trim() };

  const merge = await execa('git', ['-c', 'user.email=council@local', '-c', 'user.name=Open Council',
    'merge', '--no-edit', `origin/${baseBranch}`], { cwd, reject: false, all: true });
  if (merge.exitCode !== 0) {
    await execa('git', ['merge', '--abort'], { cwd, reject: false });
    return { ok: false, reason: `Merging origin/${baseBranch} (${baseSha.trim().slice(0, 8)}) into the execution branch conflicts:\n${(merge.all || '').slice(-2000)}` };
  }
  return { ok: true, merged: true, baseSha: baseSha.trim() };
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
