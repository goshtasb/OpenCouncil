import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CouncilConfig, RoundVerdict, VerdictType } from '../types.js';
import { SessionManager } from './session.js';
import { getHeadSha, createWorktree } from '../utils/git.js';
import { sha256File, sha256String } from '../utils/hash.js';
import { getAdapter } from '../adapters/registry.js';
import { logger } from '../utils/logger.js';

export class CouncilEngine {
  private sessionManager: SessionManager;
  private config: CouncilConfig;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async open(repoPath: string, slug: string, options: { parent?: string; continues?: string } = {}): Promise<string> {
    const absRepo = path.resolve(repoPath);
    const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const sessionId = `${dateStr}-${slug}`;
    const baseBranch = this.config.project.base_branch || 'main';
    const baseSha = await getHeadSha(absRepo);

    // Setup pristine research worktree
    const worktreeBase = path.join(os.homedir(), '.councilmen', 'worktrees', path.basename(absRepo));
    await createWorktree(absRepo, worktreeBase, baseSha);

    this.sessionManager.createSession({
      id: sessionId,
      slug,
      repoPath: absRepo,
      worktreePath: worktreeBase,
      baseRef: baseBranch,
      baseSha,
      maxRounds: this.config.council.max_rounds,
      tiebreakRound: this.config.council.tiebreak_round,
      createdAt: new Date().toISOString(),
      parentSession: options.parent,
      continuesSession: options.continues
    });

    logger.council('HARNESS', `Session opened: ${sessionId}`);
    return sessionId;
  }

  saveDraft(sessionId: string, kind: 'plan' | 'changes', content: string): string {
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const nextRound = this.sessionManager.getRoundsDone(sessionId) + 1;
    const filePath = path.join(sessionDir, `${kind}-v${nextRound}.md`);

    if (kind === 'plan') {
      if (!content.includes('# Product Brief') || !content.includes('# PRD')) {
        throw new Error("Plan must contain '# Product Brief' followed by '# PRD'.");
      }
      if (!content.includes('# Executive Summary')) {
        throw new Error("Plan must conclude with '# Executive Summary'.");
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
    this.sessionManager.logEvent(sessionId, `Saved ${kind}-v${nextRound} (${sha256String(content)})`);
    return filePath;
  }

  async askRound(sessionId: string, roundPrompt: string): Promise<RoundVerdict> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    const roundNum = roundsDone + 1;
    const roundDir = path.join(this.sessionManager.getSessionPath(sessionId), `round-${String(roundNum).padStart(2, '0')}`);
    fs.mkdirSync(roundDir, { recursive: true });

    const planFile = path.join(this.sessionManager.getSessionPath(sessionId), `plan-v${roundNum}.md`);
    if (!fs.existsSync(planFile)) {
      throw new Error(`Please save plan-v${roundNum} first.`);
    }

    // Save prompt
    fs.writeFileSync(path.join(roundDir, 'prompt.md'), roundPrompt, 'utf8');

    // Run Chief Engineer adapter
    const engineerConfig = this.config.seats.chief_engineer;
    const adapter = getAdapter(engineerConfig.provider);

    logger.council('CHIEF ENGINEER', `Deliberating round ${roundNum}...`);
    const reply = await adapter.runPrompt(roundPrompt, {
      cwd: meta.worktreePath,
      model: engineerConfig.model,
      permissionMode: 'plan',
      timeoutSeconds: this.config.council.round_timeout_seconds
    });

    fs.writeFileSync(path.join(roundDir, 'reply.md'), reply, 'utf8');

    // Parse verdict and objections
    const verdict = this.parseReply(reply, roundNum, planFile, path.join(roundDir, 'reply.md'));
    fs.writeFileSync(path.join(roundDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Round ${roundNum} finished: ${verdict.verdict}, objections: ${verdict.openObjections}, converged: ${verdict.converged}`);

    return verdict;
  }

  private parseReply(reply: string, round: number, planFile: string, replyFile: string): RoundVerdict {
    const lines = reply.split('\n').map(l => l.replace(/[*`]/g, '').trim()).filter(Boolean);
    let verdict: VerdictType = 'UNPARSEABLE';
    let openObjections = 999;

    for (const line of lines) {
      if (line.startsWith('VERDICT:')) {
        const val = line.replace('VERDICT:', '').trim();
        if (val === 'SHIP IT' || val === 'SHIP WITH CHANGES' || val === 'RETHINK') {
          verdict = val;
        }
      }
      if (line.startsWith('OPEN OBJECTIONS:')) {
        const num = parseInt(line.replace('OPEN OBJECTIONS:', '').trim(), 10);
        if (!isNaN(num)) openObjections = num;
      }
    }

    const converged = (verdict === 'SHIP IT' && openObjections === 0);
    return {
      round,
      verdict,
      openObjections,
      converged,
      replySha256: sha256File(replyFile),
      planSha256: sha256File(planFile)
    };
  }

  finalize(sessionId: string): string {
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    if (roundsDone === 0) throw new Error("No rounds have been completed.");

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const lastRoundDir = path.join(sessionDir, `round-${String(roundsDone).padStart(2, '0')}`);
    const verdict: RoundVerdict = JSON.parse(fs.readFileSync(path.join(lastRoundDir, 'verdict.json'), 'utf8'));

    if (!verdict.converged) {
      throw new Error(`Round ${roundsDone} did not converge (verdict: ${verdict.verdict}, objections: ${verdict.openObjections}). Deliberation must reach consensus.`);
    }

    const planFile = path.join(sessionDir, `plan-v${roundsDone}.md`);
    const deliverableFile = path.join(sessionDir, 'brief-and-prd.md');
    fs.copyFileSync(planFile, deliverableFile);
    fs.chmodSync(deliverableFile, 0o444); // Read-only

    const hash = sha256File(deliverableFile);
    this.sessionManager.setStatus(sessionId, 'AWAITING_APPROVAL', {
      prdSha256: hash,
      rounds: roundsDone,
      deliverable: deliverableFile
    });

    logger.council('HARNESS', `Deliverable finalized: ${deliverableFile}`);
    logger.council('OPERATOR', `To authorize, run: councilmen approve ${sessionId}`);
    return deliverableFile;
  }

  approve(sessionId: string, token: string): void {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'AWAITING_APPROVAL') {
      throw new Error(`Cannot approve session in status '${status.status}'. Must be AWAITING_APPROVAL.`);
    }

    const expectedHash = status.details?.prdSha256;
    const expectedToken = `APPROVE ${expectedHash.slice(0, 8)}`;
    if (token.trim() !== expectedToken) {
      throw new Error(`Invalid approval token. Expected: "${expectedToken}", got: "${token.trim()}"`);
    }

    this.sessionManager.setStatus(sessionId, 'APPROVED', {
      approvedAt: new Date().toISOString(),
      approvalMode: 'typed',
      prdSha256: expectedHash
    });

    logger.success(`Session ${sessionId} successfully APPROVED.`);
    logger.council('HARNESS', `Execution is now unlocked.`);
  }
}
