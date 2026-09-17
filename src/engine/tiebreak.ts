import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, TieBreakResult, TieBreakRuling } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { buildSystemPrompt, FIELD_SEPARATOR, protocolLines } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { formatArchitectRulings } from './questions.js';

export class TieBreakEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async runTieBreak(sessionId: string): Promise<TieBreakResult> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'OPEN') {
      throw new Error(`Cannot tie-break: session ${sessionId} is '${status.status}'.`);
    }
    const meta = this.sessionManager.loadMeta(sessionId);
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    const minRound = this.config.council.tiebreak_round;
    if (roundsDone < minRound) {
      throw new Error(`Tie-break is only permissible from round ${minRound} (completed: ${roundsDone}). Deliberate further.`);
    }

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const lastRoundDir = path.join(sessionDir, roundDirName('round', roundsDone));
    const verdict = JSON.parse(fs.readFileSync(path.join(lastRoundDir, 'verdict.json'), 'utf8'));
    if (verdict.converged) {
      throw new Error(`Round ${roundsDone} already converged; there is nothing to arbitrate.`);
    }
    const lastReply = fs.readFileSync(path.join(lastRoundDir, 'reply.md'), 'utf8');
    const lastPlan = fs.readFileSync(path.join(sessionDir, `plan-v${roundsDone}.md`), 'utf8');
    const changesFile = path.join(sessionDir, `changes-v${roundsDone}.md`);
    const leadRationale = fs.existsSync(changesFile) ? fs.readFileSync(changesFile, 'utf8') : '(The Lead recorded no separate rationale; see the draft.)';
    const task = this.sessionManager.loadTask(sessionId) || '(No task statement recorded.)';

    const tbDir = path.join(sessionDir, roundDirName('tiebreak', roundsDone));
    fs.mkdirSync(tbDir, { recursive: true });

    const prompt = [
      `# Council Tie-Break — Session ${sessionId}, Round ${roundsDone}`,
      '',
      '## Task',
      task,
      '',
      '## Current Draft',
      lastPlan,
      '',
      "## Council Lead's Rationale",
      leadRationale,
      '',
      "## Chief Engineer's Open Objections",
      lastReply,
      '',
      ...formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId)),
      '## Instructions',
      'Rule on every numbered objection per the Arbiter contract. Plain text only: one line per objection, `RULING <n>: STANDS | OVERRULED | MEASURE — <reason>`, then `SUMMARY: <sentence>`.'
    ].join('\n');

    fs.writeFileSync(path.join(tbDir, 'prompt.md'), prompt, 'utf8');

    const architectConfig = this.config.seats.chief_architect;
    const adapter = getAdapter(architectConfig.provider);

    logger.council('CHIEF ARCHITECT', `Arbitrating deadlock after round ${roundsDone}...`);
    this.sessionManager.setActivity('chief_architect', 'busy', `Arbitrating round ${roundsDone}`);
    let reply: string;
    try {
      reply = await adapter.runPrompt(prompt, {
        cwd: sessionDir,
        model: architectConfig.model,
        systemPrompt: buildSystemPrompt(this.config, 'chief_architect', 'tiebreak', meta.repoPath),
        timeoutSeconds: this.config.council.round_timeout_seconds
      });
    } finally {
      this.sessionManager.setActivity('chief_architect', 'idle', 'Guarding standards');
    }

    fs.writeFileSync(path.join(tbDir, 'reply.md'), reply, 'utf8');

    const result = parseTieBreak(reply, roundsDone, verdict.openObjections);
    fs.writeFileSync(path.join(tbDir, 'rulings.json'), JSON.stringify(result, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Tie-break completed with ${result.rulingsCount} rulings (expected ${result.expectedObjections}).`);
    if (result.rulingsCount === 0) {
      logger.warn('The Chief Architect reply contained no parseable RULING lines. See ' + path.join(tbDir, 'reply.md'));
    }

    return result;
  }
}

export function parseTieBreak(reply: string, round: number, expectedObjections: number = 0): TieBreakResult {
  const lines = protocolLines(reply);
  const rulings: TieBreakResult['rulings'] = [];
  let summary = 'Tie-break concluded.';
  const re = new RegExp(`^RULING\\s+(\\d+)\\s*:\\s*(STANDS|OVERRULED|MEASURE)\\b(?:${FIELD_SEPARATOR}|\\s*:\\s*|\\s+)?(.*)$`, 'i');

  for (const line of lines) {
    const match = line.match(re);
    if (match) {
      rulings.push({
        id: parseInt(match[1], 10),
        ruling: match[2].toUpperCase() as TieBreakRuling,
        reason: (match[3] || '').trim()
      });
    }
    if (/^SUMMARY\s*:/i.test(line)) {
      summary = line.replace(/^SUMMARY\s*:/i, '').trim();
    }
  }

  return {
    round,
    expectedObjections: expectedObjections === 999 ? rulings.length : expectedObjections,
    rulingsCount: rulings.length,
    rulings,
    summary
  };
}
