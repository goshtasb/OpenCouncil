import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, RoundVerdict } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { PipelineManager, syncBacklogItem } from './pipeline.js';
import { CouncilEngine } from './council.js';
import { approvalToken, isSignedOff } from './verdicts.js';
import { buildEngineerRoundPrompt, buildLeadDraftPrompt, splitLeadReply } from './deliberation-prompts.js';
import { ArchitectQuestionEngine, extractArchitectQuestions, formatArchitectRulings } from './questions.js';
import { TieBreakEngine } from './tiebreak.js';
import { ArchitectureReviewEngine } from './review.js';
import { LeadSignoffEngine, checkAllSignoffs } from './signoff.js';
import { getAdapter } from '../adapters/registry.js';
import { buildSystemPrompt } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

export type DeliberationOutcome =
  | { outcome: 'AWAITING_APPROVAL'; rounds: number; deliverable: string; approvalToken: string }
  | { outcome: 'STALLED'; rounds: number; reason: string };

/**
 * Runs the council loop for one session:
 * Lead PM drafts → Chief Engineer rounds → (tie-break from tiebreak_round) → Lead PM revisions
 * → on convergence, Chief Architect sign-off → Lead sign-off → finalize; stops (STALLED) after max_rounds.
 * Questions about undefined rules from any seat go to the Chief Architect; the Operator is never consulted mid-flight.
 * All state lives in the session directory, so an interrupted run resumes where it stopped.
 */
export class DeliberationEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;
  private council: CouncilEngine;
  private tiebreak: TieBreakEngine;
  private review: ArchitectureReviewEngine;
  private signoff: LeadSignoffEngine;
  private questions: ArchitectQuestionEngine;
  private pipeline: PipelineManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager, pipeline?: PipelineManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
    this.pipeline = pipeline || new PipelineManager(path.join(path.dirname(this.sessionManager.sessionsDir), 'backlog'));
    this.council = new CouncilEngine(config, this.sessionManager, this.pipeline);
    this.tiebreak = new TieBreakEngine(config, this.sessionManager);
    this.review = new ArchitectureReviewEngine(config, this.sessionManager);
    this.signoff = new LeadSignoffEngine(config, this.sessionManager);
    this.questions = new ArchitectQuestionEngine(config, this.sessionManager);
  }

  async run(sessionId: string): Promise<DeliberationOutcome> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'OPEN') {
      throw new Error(`Cannot deliberate: session ${sessionId} is '${status.status}'.`);
    }
    const task = this.sessionManager.loadTask(sessionId);
    if (!task || !task.trim()) {
      throw new Error(`Session ${sessionId} has no task. Open it with --task, --task-file or --item.`);
    }
    const meta = this.sessionManager.loadMeta(sessionId);
    const sessionDir = this.sessionManager.getSessionPath(sessionId);

    while (true) {
      const roundsDone = this.sessionManager.getRoundsDone(sessionId);

      if (roundsDone > 0) {
        const last = this.readVerdict(sessionDir, roundsDone);
        if (last.converged) {
          const reviewFile = path.join(sessionDir, roundDirName('review', roundsDone), 'review.json');
          const review = fs.existsSync(reviewFile)
            ? JSON.parse(fs.readFileSync(reviewFile, 'utf8'))
            : await this.review.runReview(sessionId);
          logger.council('CHIEF ARCHITECT', `Verdict on v${roundsDone}: ${review.verdict} (required ${review.requiredConcerns}, advisory ${review.advisoryConcerns})`);
          if (isSignedOff(review)) {
            const signoffFile = path.join(sessionDir, roundDirName('signoff', roundsDone), 'signoff.json');
            const lead = fs.existsSync(signoffFile)
              ? JSON.parse(fs.readFileSync(signoffFile, 'utf8'))
              : await this.signoff.runSignoff(sessionId);
            logger.council('LEAD PM', `Sign-off on v${roundsDone}: ${lead.verdict}`);
            await this.routeQuestions(sessionId, 'lead_pm', `sign-off on v${roundsDone}`, path.join(sessionDir, roundDirName('signoff', roundsDone), 'reply.md'));
          }
          if (checkAllSignoffs(this.sessionManager, sessionId).ok) {
            const deliverable = this.council.finalize(sessionId);
            const prdSha = this.sessionManager.getStatus(sessionId).details.prdSha256;
            return { outcome: 'AWAITING_APPROVAL', rounds: roundsDone, deliverable, approvalToken: approvalToken(prdSha) };
          }
        } else if (roundsDone >= meta.tiebreakRound && roundsDone < meta.maxRounds && !fs.existsSync(path.join(sessionDir, roundDirName('tiebreak', roundsDone), 'rulings.json'))) {
          await this.tiebreak.runTieBreak(sessionId);
        }
      }

      const nextRound = roundsDone + 1;
      if (nextRound > meta.maxRounds) {
        const reason = `No unanimous zero-concern sign-off after ${roundsDone} rounds (max_rounds ${meta.maxRounds}); nothing was presented to the Operator.`;
        this.sessionManager.setStatus(sessionId, 'STALLED', { reason });
        syncBacklogItem(this.pipeline, meta.backlogItem, 'parked', sessionId);
        logger.council('HARNESS', `Council stalled: ${reason}`);
        return { outcome: 'STALLED', rounds: roundsDone, reason };
      }

      if (!fs.existsSync(path.join(sessionDir, `plan-v${nextRound}.md`))) {
        await this.draftPlan(sessionId, task, nextRound);
      }

      const verdict = await this.council.askRound(sessionId, this.buildEngineerPrompt(sessionId, task, nextRound));
      logger.council('CHIEF ENGINEER', `Round ${nextRound}: ${verdict.verdict}, open objections ${verdict.openObjections === 999 ? 'unparseable' : verdict.openObjections}`);
      await this.routeQuestions(sessionId, 'chief_engineer', `round ${nextRound}`, path.join(sessionDir, roundDirName('round', nextRound), 'reply.md'));
    }
  }

  private readVerdict(sessionDir: string, round: number): RoundVerdict {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, roundDirName('round', round), 'verdict.json'), 'utf8'));
  }

  private readIfExists(file: string): string | null {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  /** Feedback the Lead PM (and the Chief Engineer) must address for the draft of `round`. */
  private feedbackFor(sessionId: string, round: number, includeEngineerReply: boolean): string[] {
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const prev = round - 1;
    if (prev < 1) return [];
    const sections: string[] = [];
    const reply = this.readIfExists(path.join(sessionDir, roundDirName('round', prev), 'reply.md'));
    if (reply && includeEngineerReply) sections.push(`## Chief Engineer's Reply to Draft v${prev}`, reply, '');
    const rulings = this.readIfExists(path.join(sessionDir, roundDirName('tiebreak', prev), 'reply.md'));
    if (rulings) sections.push(`## Binding Chief Architect Rulings on Round ${prev}`, 'STANDS: the Lead must adopt the objection. OVERRULED: the Chief Engineer must withdraw it. MEASURE: the stated measurement must be performed and its result recorded.', rulings, '');
    const review = this.readIfExists(path.join(sessionDir, roundDirName('review', prev), 'reply.md'));
    const lead = this.readIfExists(path.join(sessionDir, roundDirName('signoff', prev), 'reply.md'));
    if (review && !lead) sections.push(`## Chief Architect Review of v${prev} (not signed off — every concern, REQUIRED or ADVISORY, must be resolved)`, review, '');
    if (lead) sections.push(`## Council Lead Sign-Off Notes on v${prev} (not signed off — the listed changes are required)`, lead, '');
    return sections;
  }

  private async draftPlan(sessionId: string, task: string, version: number): Promise<void> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const previousPlan = this.readIfExists(path.join(sessionDir, `plan-v${version - 1}.md`));
    const feedback = this.feedbackFor(sessionId, version, true);

    const prompt = buildLeadDraftPrompt({ sessionId, version, task, previousPlan, feedback, rulings: this.rulings(sessionId), worktreePath: meta.worktreePath, baseSha: meta.baseSha });

    const pmConfig = this.config.seats.lead_pm;
    const adapter = getAdapter(pmConfig.provider);
    const systemPrompt = buildSystemPrompt(this.config, 'lead_pm', null, meta.repoPath);

    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const attemptPrompt = attempt === 1 ? prompt : `${prompt}\n\n## Correction\nYour previous output was rejected by the harness: ${lastError} Output the full document again in the required format.`;
      logger.council('LEAD PM', `${previousPlan ? 'Revising' : 'Drafting'} v${version}${attempt > 1 ? ' (format retry)' : ''}...`);
      this.sessionManager.setActivity('lead_pm', 'busy', `${previousPlan ? 'Revising' : 'Drafting'} v${version}`);
      let reply: string;
      try {
        reply = await adapter.runPrompt(attemptPrompt, {
          cwd: meta.worktreePath,
          model: pmConfig.model,
          permissionMode: 'plan',
          systemPrompt,
          timeoutSeconds: this.config.council.round_timeout_seconds
        });
      } finally {
        this.sessionManager.setActivity('lead_pm', 'idle', 'Standing by');
      }
      fs.writeFileSync(path.join(sessionDir, `lead-reply-v${version}${attempt > 1 ? `-attempt${attempt}` : ''}.md`), reply, 'utf8');

      const { changes, document } = splitLeadReply(reply);
      try {
        if (changes) this.council.saveDraft(sessionId, 'changes', changes);
        this.council.saveDraft(sessionId, 'plan', document);
        await this.routeQuestions(sessionId, 'lead_pm', `draft v${version}`, path.join(sessionDir, `lead-reply-v${version}${attempt > 1 ? `-attempt${attempt}` : ''}.md`));
        return;
      } catch (err: any) {
        lastError = err.message;
        logger.warn(`Lead PM draft v${version} rejected: ${lastError}`);
      }
    }
    throw new Error(`Lead PM failed to produce a valid draft v${version}: ${lastError}`);
  }

  private buildEngineerPrompt(sessionId: string, task: string, round: number): string {
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const meta = this.sessionManager.loadMeta(sessionId);
    const plan = fs.readFileSync(path.join(sessionDir, `plan-v${round}.md`), 'utf8');
    const changes = this.readIfExists(path.join(sessionDir, `changes-v${round}.md`));
    const feedback = this.feedbackFor(sessionId, round, false);
    return buildEngineerRoundPrompt({ sessionId, round, maxRounds: meta.maxRounds, task, plan, changes, feedback, rulings: this.rulings(sessionId), worktreePath: meta.worktreePath, baseSha: meta.baseSha });
  }

  private rulings(sessionId: string): string[] {
    return formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId));
  }

  /** Sends a seat's undefined-rule questions to the Chief Architect once (idempotent across resumed runs). */
  private async routeQuestions(sessionId: string, seat: string, stage: string, replyFile: string): Promise<void> {
    const questions = extractArchitectQuestions(this.readIfExists(replyFile) || '');
    if (questions.length === 0 || this.sessionManager.loadArchitectRulings(sessionId).some(r => r.stage === stage)) return;
    const plan = this.readIfExists(path.join(this.sessionManager.getSessionPath(sessionId), `plan-v${this.sessionManager.getRoundsDone(sessionId) + 1}.md`))
      || this.readIfExists(path.join(this.sessionManager.getSessionPath(sessionId), `plan-v${this.sessionManager.getRoundsDone(sessionId)}.md`))
      || '(no draft yet)';
    await this.questions.ask(sessionId, seat, stage, questions, `### Current draft\n${plan}`);
  }
}
