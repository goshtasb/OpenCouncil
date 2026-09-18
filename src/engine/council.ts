import * as fs from 'fs';
import * as path from 'path';
import { ArchitectureReviewResult, CouncilConfig, RoundVerdict } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { PipelineManager, syncBacklogItem } from './pipeline.js';
import { getHeadSha, createWorktree, isGitRepo } from '../utils/git.js';
import { sha256File, sha256String } from '../utils/hash.js';
import { projectStateDir } from '../utils/paths.js';
import { buildSystemPrompt } from '../utils/prompts.js';
import { getAdapter } from '../adapters/registry.js';
import { logger } from '../utils/logger.js';
import { checkAllSignoffs } from './signoff.js';
import { renderMarkdownToPdf } from '../utils/pdf.js';
import { approvalToken, hasHeading, parseEngineerReply } from './verdicts.js';

export interface OpenSessionOptions {
  parent?: string;
  continues?: string;
  task?: string;
  backlogItem?: string;
}

export class CouncilEngine {
  private sessionManager: SessionManager;
  private pipeline: PipelineManager;
  private config: CouncilConfig;

  constructor(config: CouncilConfig, sessionManager?: SessionManager, pipeline?: PipelineManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
    this.pipeline = pipeline || new PipelineManager(path.join(path.dirname(this.sessionManager.sessionsDir), 'backlog'));
  }

  async open(repoPath: string, slug: string, options: OpenSessionOptions = {}): Promise<string> {
    const absRepo = path.resolve(repoPath);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      throw new Error(`Invalid slug '${slug}'. Use lowercase letters, digits and dashes.`);
    }
    if (!(await isGitRepo(absRepo))) {
      throw new Error(`${absRepo} is not a git repository.`);
    }

    let task = options.task;
    if (options.backlogItem) {
      const item = this.pipeline.assertCanEnterCouncil(options.backlogItem, this.config.backlog.wip_limit);
      task = task || [item.title, item.body].filter(part => part && part.trim()).join('\n\n');
    }

    const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const sessionId = `${dateStr}-${slug}`;
    const baseBranch = this.config.project.base_branch || 'main';
    const baseSha = await getHeadSha(absRepo);

    // Pristine research worktree, one per repository (WIP limit keeps sessions from sharing it concurrently)
    const worktreePath = path.join(projectStateDir(absRepo), 'worktree');
    await createWorktree(absRepo, worktreePath, baseSha);

    this.sessionManager.createSession({
      id: sessionId,
      slug,
      repoPath: absRepo,
      worktreePath,
      baseRef: baseBranch,
      baseSha,
      maxRounds: this.config.council.max_rounds,
      signoffRevisions: this.config.council.signoff_revisions,
      tiebreakRound: this.config.council.tiebreak_round,
      createdAt: new Date().toISOString(),
      parentSession: options.parent,
      continuesSession: options.continues,
      backlogItem: options.backlogItem
    });
    if (task && task.trim()) {
      this.sessionManager.saveTask(sessionId, task);
    }
    syncBacklogItem(this.pipeline, options.backlogItem, 'in-council', sessionId);

    logger.council('HARNESS', `Session opened: ${sessionId}`);
    return sessionId;
  }

  saveDraft(sessionId: string, kind: 'plan' | 'changes', content: string): string {
    this.requireStatus(sessionId, ['OPEN'], 'save a draft');
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const nextRound = this.sessionManager.getRoundsDone(sessionId) + 1;
    const filePath = path.join(sessionDir, `${kind}-v${nextRound}.md`);

    if (kind === 'plan') {
      const missing = ['# Product Brief', '# PRD', '# Executive Summary'].filter(h => !hasHeading(content, h));
      if (missing.length > 0) {
        throw new Error(`Plan is missing required top-level heading(s): ${missing.map(m => `'${m}'`).join(', ')}.`);
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');
    this.sessionManager.logEvent(sessionId, `Saved ${kind}-v${nextRound} (${sha256String(content)})`);
    return filePath;
  }

  async askRound(sessionId: string, roundPrompt: string): Promise<RoundVerdict> {
    this.requireStatus(sessionId, ['OPEN'], 'run a deliberation round');
    const meta = this.sessionManager.loadMeta(sessionId);
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    const roundNum = roundsDone + 1;
    const hardLimit = meta.maxRounds + (meta.signoffRevisions ?? this.config.council.signoff_revisions);
    if (roundNum > hardLimit) {
      throw new Error(`Session ${sessionId} already used all ${hardLimit} rounds. The session is stalled.`);
    }
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const planFile = path.join(sessionDir, `plan-v${roundNum}.md`);
    if (!fs.existsSync(planFile)) {
      throw new Error(`Please save plan-v${roundNum} first (council draft ${sessionId} < plan.md).`);
    }

    const roundDir = path.join(sessionDir, roundDirName('round', roundNum));
    fs.mkdirSync(roundDir, { recursive: true });
    fs.writeFileSync(path.join(roundDir, 'prompt.md'), roundPrompt, 'utf8');

    const engineerConfig = this.config.seats.chief_engineer;
    const adapter = getAdapter(engineerConfig.provider);

    logger.council('CHIEF ENGINEER', `Deliberating round ${roundNum}...`);
    this.sessionManager.setActivity('chief_engineer', 'busy', `Reviewing draft v${roundNum}`);
    let reply: string;
    try {
      reply = await adapter.runPrompt(roundPrompt, {
        cwd: meta.worktreePath,
        model: engineerConfig.model,
        permissionMode: 'plan',
        systemPrompt: buildSystemPrompt(this.config, 'chief_engineer', 'member', meta.repoPath),
        timeoutSeconds: this.config.council.round_timeout_seconds
      });
    } finally {
      this.sessionManager.setActivity('chief_engineer', 'idle', 'Ready');
    }

    fs.writeFileSync(path.join(roundDir, 'reply.md'), reply, 'utf8');

    const verdict = parseEngineerReply(reply, roundNum, sha256File(planFile), sha256File(path.join(roundDir, 'reply.md')));
    fs.writeFileSync(path.join(roundDir, 'verdict.json'), JSON.stringify(verdict, null, 2), 'utf8');
    this.sessionManager.logEvent(sessionId, `Round ${roundNum} finished: ${verdict.verdict}, objections: ${verdict.openObjections}, converged: ${verdict.converged}`);

    return verdict;
  }

  /** Writes the approval PDF beside the Markdown deliverable. The Operator always reviews the PDF. */
  async writeDeliverablePdf(sessionId: string): Promise<string> {
    const prd = this.deliverable(sessionId);
    const meta = this.sessionManager.loadMeta(sessionId);
    const status = this.sessionManager.getStatus(sessionId);
    return renderMarkdownToPdf(prd.content, prd.file.replace(/\.md$/, '.pdf'), {
      title: `Product Brief & PRD — ${meta.slug}`,
      session: sessionId,
      prdSha256: prd.prdSha256,
      approvalToken: prd.approvalToken,
      signedOffBy: status.details.signedOffBy
    });
  }

  finalize(sessionId: string): string {
    this.requireStatus(sessionId, ['OPEN'], 'finalize');
    // The Operator is only ever presented a document every seat has signed off, byte for byte.
    const gate = checkAllSignoffs(this.sessionManager, sessionId);
    if (!gate.ok) {
      throw new Error(`Not all council seats have signed off. ${gate.failures.join(' ')}`);
    }
    const roundsDone = gate.round;
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const planFile = path.join(sessionDir, `plan-v${roundsDone}.md`);
    const review: ArchitectureReviewResult = JSON.parse(fs.readFileSync(path.join(sessionDir, roundDirName('review', roundsDone), 'review.json'), 'utf8'));

    const deliverableFile = path.join(sessionDir, 'brief-and-prd.md');
    if (fs.existsSync(deliverableFile)) {
      fs.chmodSync(deliverableFile, 0o644);
      fs.unlinkSync(deliverableFile);
    }
    fs.copyFileSync(planFile, deliverableFile);
    fs.chmodSync(deliverableFile, 0o444); // Read-only

    const hash = sha256File(deliverableFile);
    if (hash !== gate.planSha256) {
      throw new Error('Deliverable copy does not match the signed-off plan.');
    }
    this.sessionManager.setStatus(sessionId, 'AWAITING_APPROVAL', {
      prdSha256: hash,
      rounds: roundsDone,
      deliverable: deliverableFile,
      architectVerdict: review.verdict,
      signedOffBy: ['chief_engineer', 'chief_architect', 'lead_pm']
    });
    const meta = this.sessionManager.loadMeta(sessionId);
    syncBacklogItem(this.pipeline, meta.backlogItem, 'awaiting-approval', sessionId);

    logger.council('HARNESS', `Deliverable finalized: ${deliverableFile}`);
    logger.council('OPERATOR', `Review it with: council prd ${sessionId} (PDF alongside the deliverable)`);
    logger.council('OPERATOR', `Then authorize with: council approve ${sessionId} "${approvalToken(hash)}"`);
    return deliverableFile;
  }

  /** The exact document the Operator is asked to approve. Only available once every seat has signed off. */
  deliverable(sessionId: string): { file: string; content: string; prdSha256: string; approvalToken: string } {
    const status = this.sessionManager.getStatus(sessionId);
    if (!['AWAITING_APPROVAL', 'APPROVED', 'IN_EXECUTION', 'DONE', 'BLOCKED'].includes(status.status)) {
      throw new Error(`Session ${sessionId} has no finalized PRD (status '${status.status}'). The council has not signed one off yet.`);
    }
    const file = path.join(this.sessionManager.getSessionPath(sessionId), 'brief-and-prd.md');
    if (!fs.existsSync(file)) throw new Error(`No deliverable found for session ${sessionId}.`);
    const prdSha256 = sha256File(file);
    return { file, content: fs.readFileSync(file, 'utf8'), prdSha256, approvalToken: approvalToken(prdSha256) };
  }

  approve(sessionId: string, token: string): void {
    const status = this.requireStatus(sessionId, ['AWAITING_APPROVAL'], 'approve');

    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const expectedHash: string | undefined = status.details.prdSha256;
    if (!expectedHash) {
      throw new Error(`Session ${sessionId} has no recorded deliverable hash. Re-run finalize.`);
    }
    const actualHash = sha256File(path.join(sessionDir, 'brief-and-prd.md'));
    if (actualHash !== expectedHash) {
      throw new Error('brief-and-prd.md was modified after finalization. Refusing approval.');
    }
    const gate = checkAllSignoffs(this.sessionManager, sessionId);
    if (!gate.ok || gate.planSha256 !== expectedHash) {
      throw new Error(`Refusing approval: the deliverable no longer carries every seat's sign-off. ${gate.failures.join(' ')}`);
    }

    const expectedToken = approvalToken(expectedHash);
    if (token.trim() !== expectedToken) {
      throw new Error(`Invalid approval token. Expected: "${expectedToken}", got: "${token.trim()}"`);
    }

    this.sessionManager.setStatus(sessionId, 'APPROVED', {
      approvedAt: new Date().toISOString(),
      approvalMode: 'typed'
    });

    logger.success(`Session ${sessionId} successfully APPROVED.`);
    logger.council('HARNESS', 'Execution is now unlocked.');
  }

  private requireStatus(sessionId: string, allowed: string[], action: string) {
    const status = this.sessionManager.getStatus(sessionId);
    if (!allowed.includes(status.status)) {
      throw new Error(`Cannot ${action}: session ${sessionId} is '${status.status}' (must be ${allowed.join(' or ')}).`);
    }
    return status;
  }
}
