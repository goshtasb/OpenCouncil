import execa from 'execa';
import { logger } from '../utils/logger.js';

export interface PublishOptions {
  cwd: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  autoMerge: boolean;
}

export interface PublishResult {
  prUrl: string;
  /** 'enabled', 'disabled', or 'failed: <reason>' — auto-merge failure leaves an open PR, not a failed publish. */
  autoMerge: string;
}

/** Pushes the execution branch and opens (or reuses) its pull request. Throws if the push or PR creation fails. */
export async function publishBranch(options: PublishOptions): Promise<PublishResult> {
  const { cwd, branch } = options;
  await execa('git', ['push', '-u', 'origin', branch], { cwd });

  let prUrl: string;
  const existing = await execa('gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url'], { cwd, reject: false });
  if (existing.exitCode === 0 && existing.stdout.trim()) {
    prUrl = existing.stdout.trim();
  } else {
    const { stdout } = await execa('gh', [
      'pr', 'create',
      '--base', options.baseBranch,
      '--head', branch,
      '--title', options.title,
      '--body', options.body
    ], { cwd });
    prUrl = stdout.trim().split('\n').pop() || '';
  }
  logger.success(`Pull Request: ${prUrl}`);

  let autoMerge = 'disabled';
  if (options.autoMerge) {
    const merge = await execa('gh', ['pr', 'merge', branch, '--auto', '--squash'], { cwd, reject: false });
    autoMerge = merge.exitCode === 0 ? 'enabled' : `failed: ${(merge.stderr || merge.stdout).trim()}`;
    if (merge.exitCode === 0) logger.success('Auto-merge enabled: GitHub merges the PR once required checks pass.');
    else logger.warn(`Could not enable auto-merge (${autoMerge}). The PR is open and needs a manual merge.`);
  }
  return { prUrl, autoMerge };
}
