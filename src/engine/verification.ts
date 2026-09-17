import execa from 'execa';
import { GateResult, VerificationGate } from '../types.js';
import { describeGateFailures, failedRequiredGates, runGates } from './gates.js';

export interface VerificationInput {
  cwd: string;
  baseSha: string;
  /** `git status --porcelain` lines produced by the harness's install step, not by the Chief Engineer. */
  installArtifacts: string[];
  gates: VerificationGate[];
  failFast?: boolean;
}

export type VerificationResult =
  | { ok: true; gates: GateResult[]; headSha: string }
  | { ok: false; reason: string; gates: GateResult[]; headSha: string };

/**
 * Harness checks run after the Chief Engineer reports DONE: commits exist, the tree is clean,
 * and every required verification gate passes. Nothing is pushed until all of them hold.
 */
export async function verifyExecution(input: VerificationInput): Promise<VerificationResult> {
  const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: input.cwd });
  const fail = (reason: string, gates: GateResult[] = []): VerificationResult => ({ ok: false, reason, gates, headSha: headSha.trim() });

  const { stdout: commitCount } = await execa('git', ['rev-list', '--count', `${input.baseSha}..HEAD`], { cwd: input.cwd });
  if (parseInt(commitCount.trim(), 10) === 0) {
    return fail('DONE.md was written but no commits exist on the execution branch.');
  }

  const harnessFiles = new Set(input.installArtifacts);
  const { stdout: porcelain } = await execa('git', ['status', '--porcelain'], { cwd: input.cwd });
  const dirty = porcelain.split('\n').filter(line => line && !harnessFiles.has(line)).join('\n');
  if (dirty.trim()) {
    return fail(`Uncommitted changes remain in the execution checkout:\n${dirty}`);
  }

  const gates = await runGates(input.gates, { cwd: input.cwd, failFast: input.failFast });
  const failures = failedRequiredGates(gates);
  if (failures.length > 0) {
    return fail(`${failures.length} required verification gate(s) failed: ${failures.map(f => f.name).join(', ')}\n\n${describeGateFailures(gates)}`, gates);
  }
  return { ok: true, gates, headSha: headSha.trim() };
}
