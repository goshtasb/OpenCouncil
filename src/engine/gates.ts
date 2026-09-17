import execa from 'execa';
import { CouncilConfig, VerificationGate, GateResult } from '../types.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_GATE_TIMEOUT_SECONDS = 900;
const OUTPUT_TAIL_CHARS = 4000;

/**
 * The gates the harness must pass before it pushes a branch and opens a pull request.
 * `verification.gates` replaces the implicit lint/test pair when it is present, so a project
 * can add supply-chain, static-analysis, accessibility or performance gates of its own.
 */
export function resolveGates(config: CouncilConfig): VerificationGate[] {
  const configured = config.verification?.gates;
  const gates: VerificationGate[] = configured && configured.length > 0
    ? configured.map(gate => ({ ...gate }))
    : ([
        { name: 'lint', command: config.project.lint_command, standard: '02 Coding Practices' },
        { name: 'test', command: config.project.test_command, standard: '12-point #4 Testing & Release Engineering' }
      ].filter(gate => gate.command && gate.command.trim()) as VerificationGate[]);

  const seen = new Set<string>();
  for (const gate of gates) {
    if (!gate.name || !gate.name.trim()) throw new Error('Every verification gate needs a name.');
    if (seen.has(gate.name)) throw new Error(`Duplicate verification gate name '${gate.name}'.`);
    seen.add(gate.name);
    if (!gate.command || !gate.command.trim()) throw new Error(`Verification gate '${gate.name}' has no command.`);
    if (gate.timeout_seconds !== undefined && !(gate.timeout_seconds > 0)) {
      throw new Error(`Verification gate '${gate.name}' has a non-positive timeout.`);
    }
    if (gate.required === undefined) gate.required = true;
  }
  return gates;
}

/** Runs every gate in order, recording an evidence row per gate. Required failures block the pull request. */
export async function runGates(gates: VerificationGate[], options: { cwd: string; failFast?: boolean }): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const timeoutSeconds = gate.timeout_seconds ?? DEFAULT_GATE_TIMEOUT_SECONDS;
    const required = gate.required !== false;
    logger.council('HARNESS', `Gate ${gate.name}${required ? '' : ' (advisory)'}: ${gate.command}`);
    const startedAt = Date.now();
    let result: GateResult;
    try {
      const run = await execa(gate.command, { cwd: options.cwd, shell: true, all: true, timeout: timeoutSeconds * 1000 });
      result = {
        name: gate.name, command: gate.command, required, standard: gate.standard,
        exitCode: run.exitCode ?? 0, passed: true, durationMs: Date.now() - startedAt,
        output: (run.all || '').slice(-OUTPUT_TAIL_CHARS)
      };
      logger.success(`Gate ${gate.name} passed (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    } catch (err: any) {
      result = {
        name: gate.name, command: gate.command, required, standard: gate.standard,
        exitCode: err.exitCode ?? null, passed: false, durationMs: Date.now() - startedAt,
        timedOut: Boolean(err.timedOut), output: (err.all || err.shortMessage || '').slice(-OUTPUT_TAIL_CHARS)
      };
      const how = err.timedOut ? `timed out after ${timeoutSeconds}s` : `exited ${result.exitCode}`;
      if (required) logger.error(`Gate ${gate.name} FAILED (${how})`);
      else logger.warn(`Advisory gate ${gate.name} failed (${how}); it does not block the pull request.`);
    }
    results.push(result);
    if (!result.passed && required && options.failFast) break;
  }
  return results;
}

export function failedRequiredGates(results: GateResult[]): GateResult[] {
  return results.filter(r => r.required && !r.passed);
}

/** Feedback for the Chief Engineer: which gate failed, how, and its output tail. */
export function describeGateFailures(results: GateResult[]): string {
  return failedRequiredGates(results)
    .map(r => `### Gate '${r.name}' failed (${r.timedOut ? 'timed out' : `exit ${r.exitCode}`})\nStandard: ${r.standard || 'project gate'}\nCommand: ${r.command}\n\n${r.output}`)
    .join('\n\n');
}

/** One line per gate for the pull request body, so the audit trail travels with the change. */
export function summarizeGates(results: GateResult[]): string {
  if (results.length === 0) return 'No verification gates are configured.';
  return results
    .map(r => `- ${r.passed ? 'PASS' : r.required ? 'FAIL' : 'FAIL (advisory)'} \`${r.name}\` — \`${r.command}\` (${(r.durationMs / 1000).toFixed(1)}s)${r.standard ? ` — ${r.standard}` : ''}`)
    .join('\n');
}
