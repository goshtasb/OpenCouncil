import { ArchitectureReviewResult, RoundVerdict, VerdictType } from '../types.js';
import { protocolLines } from '../utils/prompts.js';
import { extractArchitectQuestions } from './questions.js';

export function approvalToken(prdSha256: string): string {
  return `APPROVE ${prdSha256.slice(0, 8)}`;
}

export function hasHeading(content: string, heading: string): boolean {
  return content.split('\n').some(line => line.trim().toLowerCase() === heading.toLowerCase());
}

/** A PRD may only be submitted with zero concerns: a plain SIGN-OFF, no REQUIRED and no ADVISORY concerns. */
export function isSignedOff(review: ArchitectureReviewResult): boolean {
  return review.verdict === 'SIGN-OFF' && review.requiredConcerns === 0 && review.advisoryConcerns === 0;
}

function headerValue(line: string, key: string): string | null {
  const m = line.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i'));
  return m ? m[1].trim().replace(/[.!]+$/, '').trim() : null;
}

export function parseEngineerReply(reply: string, round: number, planSha256: string, replySha256: string): RoundVerdict {
  const lines = protocolLines(reply);
  let verdict: VerdictType = 'UNPARSEABLE';
  let openObjections = 999;

  for (const line of lines) {
    const v = headerValue(line, 'VERDICT');
    if (v !== null && verdict === 'UNPARSEABLE') {
      const val = v.toUpperCase();
      if (val === 'SHIP IT' || val === 'SHIP WITH CHANGES' || val === 'RETHINK') {
        verdict = val;
      }
    }
    const o = headerValue(line, 'OPEN OBJECTIONS');
    if (o !== null && openObjections === 999 && /^\d+$/.test(o)) {
      openObjections = parseInt(o, 10);
    }
  }

  return {
    round,
    verdict,
    openObjections,
    // An open question for the Chief Architect is unresolved uncertainty, so it blocks convergence.
    converged: verdict === 'SHIP IT' && openObjections === 0 && extractArchitectQuestions(reply).length === 0,
    replySha256,
    planSha256
  };
}
