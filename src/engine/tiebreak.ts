import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, TieBreakResult, TieBreakRuling } from '../types.js';
import { SessionManager } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { logger } from '../utils/logger.js';

export class TieBreakEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async runTieBreak(sessionId: string): Promise<TieBreakResult> {
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    const minRound = this.config.council.tiebreak_round;
    if (roundsDone < minRound) {
      throw new Error(`Tie-break is only permissible from round ${minRound} (completed: ${roundsDone}). Deliberate further.`);
    }

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const lastRoundDir = path.join(sessionDir, `round-${String(roundsDone).padStart(2, '0')}`);
    const lastReply = fs.readFileSync(path.join(lastRoundDir, 'reply.md'), 'utf8');
    const lastPlan = fs.readFileSync(path.join(sessionDir, `plan-v${roundsDone}.md`), 'utf8');

    const tbDir = path.join(sessionDir, `tiebreak-${String(roundsDone).padStart(2, '0')}`);
    fs.mkdirSync(tbDir, { recursive: true });

    const prompt = [
      `# Council Tie-Break — Session ${sessionId}, Round ${roundsDone}`,
      '',
      '## Current Draft',
      lastPlan,
      '',
      "## Chief Engineer's Open Objections",
      lastReply,
      '',
      '## Instructions',
      'Rule on every numbered objection per the Arbiter contract. Plain text only: RULING <n>: STANDS | OVERRULED | MEASURE — <reason>'
    ].join('\n');

    fs.writeFileSync(path.join(tbDir, 'prompt.md'), prompt, 'utf8');

    const architectConfig = this.config.seats.chief_architect;
    const adapter = getAdapter(architectConfig.provider);

    logger.council('CHIEF ARCHITECT', `Arbitrating deadlock after round ${roundsDone}...`);
    const reply = await adapter.runPrompt(prompt, {
      cwd: sessionDir,
      model: architectConfig.model,
      timeoutSeconds: 480
    });

    fs.writeFileSync(path.join(tbDir, 'reply.md'), reply, 'utf8');

    const result = this.parseTieBreak(reply, roundsDone);
    fs.writeFileSync(path.join(tbDir, 'rulings.json'), JSON.stringify(result, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Tie-break completed with ${result.rulingsCount} rulings.`);

    return result;
  }

  private parseTieBreak(reply: string, round: number): TieBreakResult {
    const lines = reply.split('\n').map(l => l.replace(/[*`]/g, '').trim()).filter(Boolean);
    const rulings: Array<{ id: number; ruling: TieBreakRuling; reason: string }> = [];
    let summary = 'Tie-break concluded.';

    for (const line of lines) {
      const match = line.match(/^RULING (\d+):\s*(STANDS|OVERRULED|MEASURE)\s*—?\s*(.*)$/);
      if (match) {
        rulings.push({
          id: parseInt(match[1], 10),
          ruling: match[2] as TieBreakRuling,
          reason: match[3] || ''
        });
      }
      if (line.startsWith('SUMMARY:')) {
        summary = line.replace('SUMMARY:', '').trim();
      }
    }

    return {
      round,
      expectedObjections: rulings.length,
      rulingsCount: rulings.length,
      rulings,
      summary
    };
  }
}
