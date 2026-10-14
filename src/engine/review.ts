import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, ArchitectureReviewResult, ArchitectVerdictType } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { sha256File, sha256String } from '../utils/hash.js';
import { buildSystemPrompt, FIELD_SEPARATOR, protocolLines } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { formatArchitectRulings } from './questions.js';
import { sessionProfile } from './deliberation-prompts.js';

export const FULL_REVIEW_INSTRUCTION =
  'Audit this specification against the 12-point industry standards checklist per the Architecture Review contract. Mark inapplicable points `POINT <n>: N/A — <reason>` rather than skipping them.';
/**
 * Resubmission rule. The dominant stall in live councils was review churn: the Engineer ratified every
 * revision while the Architect raised a different concern each round, each of which had been present and
 * unraised on the version before. A concern that was available last time and not raised is waived.
 */
export const RESUBMISSION_INSTRUCTION =
  'This is a resubmission: your previous review and the council\'s response to it are above. Judge whether each earlier concern is resolved. A concern that could have been raised on the previous version and was not is waived: raise a new concern only if this revision introduced the problem (name the changed text) or if it is REQUIRED under a starred point or a mandatory project standard. Do not add advisory concerns about text that was already present in the version you reviewed before.';
export const QUICK_REVIEW_INSTRUCTION =
  'Quick profile: audit this specification against the six starred checklist points (1 Change Management, 2 Secure Development, 3 Software Supply Chain, 4 Testing & Release Engineering, 5 Data Privacy & Governance, 6 Architecture Decisions & Requirements Quality) and the Project Engineering Standards. Write `POINT <n>: N/A — quick profile` for points 7 to 12 unless the change plainly touches one, and mark any starred point that cannot apply `POINT <n>: N/A — <reason>`.';

export class ArchitectureReviewEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async runReview(sessionId: string): Promise<ArchitectureReviewResult> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'OPEN') {
      throw new Error(`Cannot review: session ${sessionId} is '${status.status}'.`);
    }
    const meta = this.sessionManager.loadMeta(sessionId);
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    if (roundsDone < 1) throw new Error('No rounds have been deliberated yet.');

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const verdict = JSON.parse(fs.readFileSync(path.join(sessionDir, roundDirName('round', roundsDone), 'verdict.json'), 'utf8'));
    if (!verdict.converged) {
      throw new Error(`Round ${roundsDone} has not converged (verdict: ${verdict.verdict}, objections: ${verdict.openObjections}). The architecture review runs on agreed documents only.`);
    }
    const planFile = path.join(sessionDir, `plan-v${roundsDone}.md`);
    const planText = fs.readFileSync(planFile, 'utf8');
    const task = this.sessionManager.loadTask(sessionId) || '(No task statement recorded.)';
    const previous = this.previousReview(sessionDir, roundsDone);

    const reviewDir = path.join(sessionDir, roundDirName('review', roundsDone));
    fs.mkdirSync(reviewDir, { recursive: true });

    const prompt = [
      `# Architecture Review — Session ${sessionId}, Agreed Document v${roundsDone}`,
      '',
      '## Task',
      task,
      '',
      '## Agreed Specification',
      planText,
      '',
      ...(previous ? [
        `## Your Previous Review (v${previous.round})`,
        previous.reply,
        '',
        `## The Council's Response to That Review`,
        previous.response || '(The Lead recorded no separate response; compare the documents.)',
        ''
      ] : []),
      ...formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId)),
      '## Instructions',
      ...(previous ? [RESUBMISSION_INSTRUCTION] : []),
      `${sessionProfile(meta, this.config) === 'quick' ? QUICK_REVIEW_INSTRUCTION : FULL_REVIEW_INSTRUCTION} Output one line per concern, \`CONCERN <n>: REQUIRED | ADVISORY — <principle/standard> — <explanation>\`, then \`VERDICT: SIGN-OFF | SIGN-OFF WITH CONCERNS | RETHINK\`, then \`SUMMARY: <sentence>\`. Only a plain SIGN-OFF with zero concerns lets the document proceed to the Operator.`
    ].join('\n');

    fs.writeFileSync(path.join(reviewDir, 'prompt.md'), prompt, 'utf8');

    const architectConfig = this.config.seats.chief_architect;
    const adapter = getAdapter(architectConfig.provider);

    logger.council('CHIEF ARCHITECT', `Conducting architecture sign-off review on v${roundsDone}...`);
    this.sessionManager.setActivity('chief_architect', 'busy', `Reviewing v${roundsDone}`);
    let reply: string;
    try {
      reply = await adapter.runPrompt(prompt, {
        cwd: sessionDir,
        model: architectConfig.model,
        systemPrompt: buildSystemPrompt(this.config, 'chief_architect', 'review', meta.repoPath),
        timeoutSeconds: this.config.council.round_timeout_seconds
      });
    } finally {
      this.sessionManager.setActivity('chief_architect', 'idle', 'Guarding standards');
    }

    fs.writeFileSync(path.join(reviewDir, 'reply.md'), reply, 'utf8');

    const result = parseReview(reply, roundsDone, sha256File(planFile), sha256String(reply));
    fs.writeFileSync(path.join(reviewDir, 'review.json'), JSON.stringify(result, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Architecture review finished: ${result.verdict} (Required: ${result.requiredConcerns}, Advisory: ${result.advisoryConcerns})`);

    return result;
  }

  /** The most recent earlier review of this session, with the Lead's response to it (changes-v<round>.md), if any. */
  private previousReview(sessionDir: string, round: number): { round: number; reply: string; response: string | null } | null {
    for (let r = round - 1; r >= 1; r--) {
      const file = path.join(sessionDir, roundDirName('review', r), 'reply.md');
      if (!fs.existsSync(file)) continue;
      const response = path.join(sessionDir, `changes-v${round}.md`);
      return { round: r, reply: fs.readFileSync(file, 'utf8'), response: fs.existsSync(response) ? fs.readFileSync(response, 'utf8') : null };
    }
    return null;
  }
}

export function parseReview(reply: string, round: number, planSha256: string, replySha256: string): ArchitectureReviewResult {
  const lines = protocolLines(reply);
  let verdict: ArchitectVerdictType = 'UNPARSEABLE';
  let summary = 'Architecture review concluded.';
  const concerns: ArchitectureReviewResult['concerns'] = [];
  const concernRe = new RegExp(`^CONCERN\\s+(\\d+)\\s*:\\s*(REQUIRED|ADVISORY)(?:${FIELD_SEPARATOR})(.+?)(?:${FIELD_SEPARATOR})(.*)$`, 'i');

  for (const line of lines) {
    const cMatch = line.match(concernRe);
    if (cMatch) {
      concerns.push({
        id: parseInt(cMatch[1], 10),
        type: cMatch[2].toUpperCase() as 'REQUIRED' | 'ADVISORY',
        principle: cMatch[3].trim(),
        description: cMatch[4].trim()
      });
    } else if (/^CONCERN\s+\d+\s*:\s*REQUIRED\b/i.test(line)) {
      // A REQUIRED concern that does not follow the field format still blocks sign-off.
      concerns.push({ id: parseInt(line.match(/\d+/)![0], 10), type: 'REQUIRED', principle: '(unformatted)', description: line });
    } else if (/^CONCERN\s+\d+\s*:\s*ADVISORY\b/i.test(line)) {
      concerns.push({ id: parseInt(line.match(/\d+/)![0], 10), type: 'ADVISORY', principle: '(unformatted)', description: line });
    }
    const v = line.match(/^VERDICT\s*:\s*(.*)$/i);
    if (v) {
      const val = v[1].trim().replace(/[.!]+$/, '').toUpperCase().replace(/\s*[—–-]\s*/g, '-').replace(/SIGN-OFF-WITH/, 'SIGN-OFF WITH');
      const normalized = val.replace(/SIGN OFF/g, 'SIGN-OFF');
      if (normalized === 'SIGN-OFF' || normalized === 'SIGN-OFF WITH CONCERNS' || normalized === 'RETHINK') {
        verdict = normalized;
      }
    }
    if (/^SUMMARY\s*:/i.test(line)) {
      summary = line.replace(/^SUMMARY\s*:/i, '').trim();
    }
  }

  const requiredConcerns = concerns.filter(c => c.type === 'REQUIRED').length;
  const advisoryConcerns = concerns.filter(c => c.type === 'ADVISORY').length;

  // Per the review contract, any REQUIRED concern means RETHINK and any ADVISORY concern rules out a plain SIGN-OFF.
  if (requiredConcerns > 0 && verdict !== 'UNPARSEABLE') {
    verdict = 'RETHINK';
  } else if (advisoryConcerns > 0 && verdict === 'SIGN-OFF') {
    verdict = 'SIGN-OFF WITH CONCERNS';
  }

  return { round, verdict, requiredConcerns, advisoryConcerns, concerns, summary, planSha256, replySha256 };
}
