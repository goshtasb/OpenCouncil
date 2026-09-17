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

export async function createWorktree(repoPath: string, worktreePath: string, commitOrBranch: string): Promise<void> {
  if (fs.existsSync(worktreePath)) {
    // Reset worktree to pristine state
    await execa('git', ['reset', '--hard', 'HEAD'], { cwd: worktreePath });
    await execa('git', ['clean', '-qfdx', '-e', 'node_modules', '-e', '.venv'], { cwd: worktreePath });
    await execa('git', ['checkout', '--quiet', '--detach', commitOrBranch], { cwd: worktreePath });
  } else {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await execa('git', ['worktree', 'add', '--quiet', '--detach', worktreePath, commitOrBranch], { cwd: repoPath });
  }
}

export async function cloneForExecution(repoPath: string, targetPath: string, branch: string, baseSha: string): Promise<void> {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    // Use origin remote url or local path
    let origin = repoPath;
    try {
      const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
      if (stdout.trim()) origin = stdout.trim();
    } catch {}
    await execa('git', ['clone', '--quiet', origin, targetPath]);
    await execa('git', ['checkout', '--quiet', '-b', branch, baseSha], { cwd: targetPath });
  }
}
