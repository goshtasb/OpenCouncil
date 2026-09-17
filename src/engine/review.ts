import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, ArchitectureReviewResult, ArchitectVerdictType } from '../types.js';
import { SessionManager } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { sha256File } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

export class ArchitectureReviewEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async runReview(sessionId: string): Promise<ArchitectureReviewResult> {
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    if (roundsDone < 1) throw new Error("No rounds have been deliberated yet.");

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const planFile = path.join(sessionDir, `plan-v${roundsDone}.md`);
    const planText = fs.readFileSync(planFile, 'utf8');

    const reviewDir = path.join(sessionDir, `review-${String(roundsDone).padStart(2, '0')}`);
    fs.mkdirSync(reviewDir, { recursive: true });

    const prompt = [
      `# Architecture Review — Session ${sessionId}, Agreed Document v${roundsDone}`,
      '',
      '## Agreed Specification',
      planText,
      '',
      '## Instructions',
      'Audit this specification against the 8-point industry standards checklist. Output CONCERN <n>: REQUIRED | ADVISORY, then VERDICT: SIGN-OFF | SIGN-OFF WITH CONCERNS | RETHINK, then SUMMARY: <sentence>.'
    ].join('\n');

    fs.writeFileSync(path.join(reviewDir, 'prompt.md'), prompt, 'utf8');

    const architectConfig = this.config.seats.chief_architect;
    const adapter = getAdapter(architectConfig.provider);

    logger.council('CHIEF ARCHITECT', `Conducting architecture sign-off review on v${roundsDone}...`);
    const reply = await adapter.runPrompt(prompt, {
      cwd: sessionDir,
      model: architectConfig.model,
      timeoutSeconds: 480
    });

    fs.writeFileSync(path.join(reviewDir, 'reply.md'), reply, 'utf8');

    const result = this.parseReview(reply, roundsDone, planFile, path.join(reviewDir, 'reply.md'));
    fs.writeFileSync(path.join(reviewDir, 'review.json'), JSON.stringify(result, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Architecture review finished: ${result.verdict} (Required: ${result.requiredConcerns}, Advisory: ${result.advisoryConcerns})`);

    return result;
  }

  private parseReview(reply: string, round: number, planFile: string, replyFile: string): ArchitectureReviewResult {
    const lines = reply.split('\n').map(l => l.replace(/[*`]/g, '').trim()).filter(Boolean);
    let verdict: ArchitectVerdictType = 'UNPARSEABLE';
    let summary = 'Architecture review concluded.';
    const concerns: ArchitectureReviewResult['concerns'] = [];

    for (const line of lines) {
      const cMatch = line.match(/^CONCERN (\d+):\s*(REQUIRED|ADVISORY)\s*—\s*([^—]+)\s*—\s*(.*)$/);
      if (cMatch) {
        concerns.push({
          id: parseInt(cMatch[1], 10),
          type: cMatch[2] as 'REQUIRED' | 'ADVISORY',
          principle: cMatch[3].trim(),
          description: cMatch[4].trim()
        });
      }
      if (line.startsWith('VERDICT:')) {
        const val = line.replace('VERDICT:', '').trim();
        if (val === 'SIGN-OFF' || val === 'SIGN-OFF WITH CONCERNS' || val === 'RETHINK') {
          verdict = val;
        }
      }
      if (line.startsWith('SUMMARY:')) {
        summary = line.replace('SUMMARY:', '').trim();
      }
    }

    const requiredConcerns = concerns.filter(c => c.type === 'REQUIRED').length;
    const advisoryConcerns = concerns.filter(c => c.type === 'ADVISORY').length;

    return {
      round,
      verdict,
      requiredConcerns,
      advisoryConcerns,
      concerns,
      summary,
      planSha256: sha256File(planFile),
      replySha256: sha256File(replyFile)
    };
  }
}
