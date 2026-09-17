import execa from 'execa';
import { logger } from '../utils/logger.js';

export interface VerificationInput {
  cwd: string;
  baseSha: string;
  /** `git status --porcelain` lines produced by the harness's install step, not by the Chief Engineer. */
  installArtifacts: string[];
  lintCommand: string;
  testCommand: string;
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

/** Harness checks run after the Chief Engineer reports DONE: commits exist, tree is clean, lint and tests pass. */
export async function verifyExecution(input: VerificationInput): Promise<VerificationResult> {
  const { stdout: commitCount } = await execa('git', ['rev-list', '--count', `${input.baseSha}..HEAD`], { cwd: input.cwd });
  if (parseInt(commitCount.trim(), 10) === 0) {
    return { ok: false, reason: 'DONE.md was written but no commits exist on the execution branch.' };
  }

  const harnessFiles = new Set(input.installArtifacts);
  const { stdout: porcelain } = await execa('git', ['status', '--porcelain'], { cwd: input.cwd });
  const dirty = porcelain.split('\n').filter(line => line && !harnessFiles.has(line)).join('\n');
  if (dirty.trim()) {
    return { ok: false, reason: `Uncommitted changes remain in the execution checkout:\n${dirty}` };
  }

  for (const [label, command] of [['lint', input.lintCommand], ['test', input.testCommand]] as const) {
    if (!command) continue;
    logger.council('HARNESS', `Verifying ${label}: ${command}`);
    try {
      await execa(command, { cwd: input.cwd, shell: true, all: true });
    } catch (err: any) {
      return { ok: false, reason: `${label} command failed: ${command}\n${(err.all || '').slice(-4000)}` };
    }
  }
  return { ok: true };
}
