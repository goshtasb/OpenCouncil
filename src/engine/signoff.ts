import * as fs from 'fs';
import * as path from 'path';
import { ArchitectureReviewResult, CouncilConfig, LeadSignoffResult, RoundVerdict } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { sha256File, sha256String } from '../utils/hash.js';
import { buildSystemPrompt, protocolLines } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { isSignedOff } from './verdicts.js';
import { extractArchitectQuestions, formatArchitectRulings } from './questions.js';

export interface SignoffGate {
  ok: boolean;
  round: number;
  planSha256: string;
  failures: string[];
}

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null;
}

/**
 * The single rule deciding whether a document may be presented to the Operator:
 * the Chief Engineer ratified (SHIP IT, 0 objections), the Chief Architect signed off with no REQUIRED concerns,
 * and the Council Lead signed off — all three on the byte-identical latest plan.
 */
export function checkAllSignoffs(sessionManager: SessionManager, sessionId: string): SignoffGate {
  const sessionDir = sessionManager.getSessionPath(sessionId);
  const round = sessionManager.getRoundsDone(sessionId);
  const failures: string[] = [];
  const planFile = path.join(sessionDir, `plan-v${round}.md`);
  const planSha256 = round > 0 ? sha256File(planFile) : '';
  if (round === 0 || !planSha256) {
    return { ok: false, round, planSha256, failures: ['No deliberation round has been completed.'] };
  }

  const verdict = readJson<RoundVerdict>(path.join(sessionDir, roundDirName('round', round), 'verdict.json'));
  if (!verdict || !verdict.converged) {
    failures.push(`Chief Engineer has not ratified plan-v${round} (verdict: ${verdict?.verdict ?? 'none'}, open objections: ${verdict?.openObjections ?? 'n/a'}).`);
  } else if (verdict.planSha256 !== planSha256) {
    failures.push(`plan-v${round} changed after the Chief Engineer ratified it.`);
  }

  const review = readJson<ArchitectureReviewResult>(path.join(sessionDir, roundDirName('review', round), 'review.json'));
  if (!review) {
    failures.push(`Chief Architect has not reviewed plan-v${round}.`);
  } else if (review.planSha256 !== planSha256) {
    failures.push(`Chief Architect reviewed a different version of plan-v${round}.`);
  } else if (!isSignedOff(review)) {
    failures.push(`Chief Architect did not sign off plan-v${round} with zero concerns (verdict: ${review.verdict}, required: ${review.requiredConcerns}, advisory: ${review.advisoryConcerns}).`);
  }

  const lead = readJson<LeadSignoffResult>(path.join(sessionDir, roundDirName('signoff', round), 'signoff.json'));
  if (!lead) {
    failures.push(`Council Lead has not signed off plan-v${round}.`);
  } else if (lead.planSha256 !== planSha256) {
    failures.push(`Council Lead signed off a different version of plan-v${round}.`);
  } else if (lead.verdict !== 'SIGN-OFF') {
    failures.push(`Council Lead did not sign off plan-v${round} (verdict: ${lead.verdict}).`);
  }

  return { ok: failures.length === 0, round, planSha256, failures };
}

export class LeadSignoffEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async runSignoff(sessionId: string): Promise<LeadSignoffResult> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'OPEN') {
      throw new Error(`Cannot sign off: session ${sessionId} is '${status.status}'.`);
    }
    const meta = this.sessionManager.loadMeta(sessionId);
    const round = this.sessionManager.getRoundsDone(sessionId);
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const gate = checkAllSignoffs(this.sessionManager, sessionId);
    const blocking = gate.failures.filter(f => !f.startsWith('Council Lead'));
    if (blocking.length > 0) {
      throw new Error(`The Council Lead signs off last, after the other seats. Outstanding: ${blocking.join(' ')}`);
    }

    const planFile = path.join(sessionDir, `plan-v${round}.md`);
    const review = fs.readFileSync(path.join(sessionDir, roundDirName('review', round), 'reply.md'), 'utf8');
    const prompt = [
      `# Council Lead Final Sign-Off — Session ${sessionId}, Document v${round}`,
      '',
      '## Task (from the Operator)',
      this.sessionManager.loadTask(sessionId) || '(No task statement recorded.)',
      '',
      '## Final Document (ratified by the Chief Engineer, signed off by the Chief Architect)',
      fs.readFileSync(planFile, 'utf8'),
      '',
      "## Chief Architect's Review",
      review,
      '',
      ...formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId)),
      '## Instructions',
      'This exact document is what the Operator will be asked to approve. Sign off only if it fully answers the task and you have zero remaining concerns. If a rule you need is undefined, do not assume: add `QUESTION FOR ARCHITECT: <question>` lines (this counts as RETHINK).',
      'Reply with exactly `VERDICT: SIGN-OFF` or `VERDICT: RETHINK` on the first line, then `SUMMARY: <one sentence>`. If RETHINK, list the numbered changes you require.'
    ].join('\n');

    const signoffDir = path.join(sessionDir, roundDirName('signoff', round));
    fs.mkdirSync(signoffDir, { recursive: true });
    fs.writeFileSync(path.join(signoffDir, 'prompt.md'), prompt, 'utf8');

    const pmConfig = this.config.seats.lead_pm;
    logger.council('LEAD PM', `Final sign-off review of v${round}...`);
    this.sessionManager.setActivity('lead_pm', 'busy', `Signing off v${round}`);
    let reply: string;
    try {
      reply = await getAdapter(pmConfig.provider).runPrompt(prompt, {
        cwd: meta.worktreePath,
        model: pmConfig.model,
        permissionMode: 'plan',
        systemPrompt: buildSystemPrompt(this.config, 'lead_pm', null, meta.repoPath),
        timeoutSeconds: this.config.council.round_timeout_seconds
      });
    } finally {
      this.sessionManager.setActivity('lead_pm', 'idle', 'Standing by');
    }
    fs.writeFileSync(path.join(signoffDir, 'reply.md'), reply, 'utf8');

    const result = parseLeadSignoff(reply, round, sha256File(planFile), sha256String(reply));
    fs.writeFileSync(path.join(signoffDir, 'signoff.json'), JSON.stringify(result, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Council Lead sign-off on v${round}: ${result.verdict}`);
    return result;
  }
}

export function parseLeadSignoff(reply: string, round: number, planSha256: string, replySha256: string): LeadSignoffResult {
  const lines = protocolLines(reply);
  let verdict: LeadSignoffResult['verdict'] = 'UNPARSEABLE';
  let summary = '';
  for (const line of lines) {
    const v = line.match(/^VERDICT\s*:\s*(.*)$/i);
    if (v && verdict === 'UNPARSEABLE') {
      const val = v[1].trim().replace(/[.!]+$/, '').toUpperCase().replace(/^SIGN\s*-?\s*OFF$/, 'SIGN-OFF');
      if (val === 'SIGN-OFF' || val === 'RETHINK') verdict = val;
    }
    if (/^SUMMARY\s*:/i.test(line) && !summary) summary = line.replace(/^SUMMARY\s*:/i, '').trim();
  }
  // Signing off while asking the Chief Architect something is not a sign-off.
  if (verdict === 'SIGN-OFF' && extractArchitectQuestions(reply).length > 0) verdict = 'RETHINK';
  return { round, verdict, summary, planSha256, replySha256 };
}
