import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, CouncilSessionMeta, RoundVerdict } from '../types.js';
import { SessionManager, roundDirName } from './session.js';
import { PipelineManager, syncBacklogItem } from './pipeline.js';
import { CouncilEngine } from './council.js';
import { approvalToken, isSignedOff } from './verdicts.js';
import { buildEngineerRoundPrompt, buildLeadDraftPrompt, recoverSavedDocument, sessionProfile, splitLeadReply } from './deliberation-prompts.js';
import { ArchitectQuestionEngine, extractArchitectQuestions, formatArchitectRulings } from './questions.js';
import { TieBreakEngine } from './tiebreak.js';
import { ArchitectureReviewEngine } from './review.js';
import { LeadSignoffEngine, checkAllSignoffs } from './signoff.js';
import { getAdapter } from '../adapters/registry.js';
import { buildSystemPrompt } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

export const STALL_REPORT_FILE = 'stalled-draft-and-objections.md';

export type DeliberationOutcome =
  | { outcome: 'AWAITING_APPROVAL'; rounds: number; deliverable: string; deliverablePdf: string; approvalToken: string }
  | { outcome: 'STALLED'; rounds: number; reason: string; report: string | null };

/**
 * Runs the council loop for one session:
 * Lead PM drafts → Chief Engineer rounds → (tie-break from tiebreak_round, or earlier when objections stop dropping)
 * → Lead PM revisions → on convergence, Chief Architect sign-off → Lead sign-off → finalize; stops (STALLED) after max_rounds.
 * Questions about undefined rules from any seat go to the Chief Architect; the Operator is never consulted mid-flight.
 * All state lives in the session directory, so an interrupted run resumes where it stopped. A stall, or a run that
 * dies on a seat failure, leaves the last draft and the open objections in one file instead of nothing.
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
    try {
      return await this.loop(sessionId, task, meta);
    } catch (err: any) {
      // A seat that died mid-run must not leave the Operator with nothing: keep what the council produced so far.
      const report = this.writeStallReport(sessionId, task, `Interrupted by a harness error (the session stays OPEN; 'council deliberate' resumes it): ${err.message}`);
      if (report) logger.warn(`Partial result so far (last draft + open objections, not approved): ${report}`);
      throw err;
    }
  }

  private async loop(sessionId: string, task: string, meta: CouncilSessionMeta): Promise<DeliberationOutcome> {
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    // A document that the Chief Engineer has ratified must be allowed to answer sign-off concerns,
    // even if convergence happened on the last ordinary round.
    const signoffBudget = meta.signoffRevisions ?? this.config.council.signoff_revisions;
    let roundLimit = meta.maxRounds;

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
          if (roundsDone >= roundLimit && signoffBudget > 0) {
            // Convergence was reached; spend the sign-off budget on resolving the concerns raised above.
            roundLimit = meta.maxRounds + signoffBudget;
            logger.council('HARNESS', `Granting ${signoffBudget} sign-off revision round(s) (limit now ${roundLimit}).`);
          }
          if (checkAllSignoffs(this.sessionManager, sessionId).ok) {
            const deliverable = this.council.finalize(sessionId);
            const deliverablePdf = await this.council.writeDeliverablePdf(sessionId);
            const prdSha = this.sessionManager.getStatus(sessionId).details.prdSha256;
            logger.council('OPERATOR', `PRD for approval (PDF): ${deliverablePdf}`);
            return { outcome: 'AWAITING_APPROVAL', rounds: roundsDone, deliverable, deliverablePdf, approvalToken: approvalToken(prdSha) };
          }
        } else if (roundsDone < roundLimit && !fs.existsSync(path.join(sessionDir, roundDirName('tiebreak', roundsDone), 'rulings.json'))) {
          if (roundsDone >= meta.tiebreakRound) {
            await this.tiebreak.runTieBreak(sessionId);
          } else {
            const stuck = this.noProgress(sessionDir, roundsDone);
            if (stuck) {
              logger.council('HARNESS', `Open objections have not dropped for ${stuck.length} rounds (${stuck.join(' → ')}); the Chief Architect arbitrates now instead of waiting for round ${meta.tiebreakRound}.`);
              await this.tiebreak.runTieBreak(sessionId, { early: true });
            }
          }
        }
      }

      const nextRound = roundsDone + 1;
      if (nextRound > roundLimit) {
        const reason = `No unanimous zero-concern sign-off after ${roundsDone} rounds (max_rounds ${meta.maxRounds}, sign-off revisions ${signoffBudget}); nothing was presented to the Operator.`;
        const report = this.writeStallReport(sessionId, task, reason);
        this.sessionManager.setStatus(sessionId, 'STALLED', { reason, partialReport: report || undefined });
        syncBacklogItem(this.pipeline, meta.backlogItem, 'parked', sessionId);
        logger.council('HARNESS', `Council stalled: ${reason}`);
        if (report) logger.council('HARNESS', `Partial result (last draft + open objections, not approved): ${report}`);
        return { outcome: 'STALLED', rounds: roundsDone, reason, report };
      }

      if (!fs.existsSync(path.join(sessionDir, `plan-v${nextRound}.md`))) {
        await this.draftPlan(sessionId, task, nextRound);
      }

      const verdict = await this.council.askRound(sessionId, this.buildEngineerPrompt(sessionId, task, nextRound));
      logger.council('CHIEF ENGINEER', `Round ${nextRound}: ${verdict.verdict}, open objections ${verdict.openObjections === 999 ? 'unparseable' : verdict.openObjections}`);
      await this.routeQuestions(sessionId, 'chief_engineer', `round ${nextRound}`, path.join(sessionDir, roundDirName('round', nextRound), 'reply.md'));
    }
  }

  /**
   * The open-objection counts of the last `no_progress_rounds` rounds when none of them dropped below the one
   * before it (an unparseable reply counts as no progress), or null. Returns null while a tie-break issued inside
   * that window has not yet had its rounds to take effect. Past live councils circled for 10+ rounds on the same
   * objection; arbitrating at the third flat round ends that at a fraction of the quota.
   */
  private noProgress(sessionDir: string, roundsDone: number): number[] | null {
    const window = this.config.council.no_progress_rounds ?? 3;
    if (window <= 0 || roundsDone < window) return null;
    const first = roundsDone - window + 1;
    const counts: number[] = [];
    for (let round = first; round <= roundsDone; round++) counts.push(this.readVerdict(sessionDir, round).openObjections);
    const dropped = counts.some((count, i) => i > 0 && count < counts[i - 1]);
    if (dropped) return null;
    for (let round = first; round < roundsDone; round++) {
      if (fs.existsSync(path.join(sessionDir, roundDirName('tiebreak', round), 'rulings.json'))) return null;
    }
    return counts;
  }

  /**
   * Writes the useful remains of a council that did not finish: the latest draft, the Chief Engineer's open objections
   * on it, and any Architect rulings or concerns and Lead notes that were still unresolved. Never a deliverable: it is
   * not signed off and `approve` will not accept it. Returns null when no draft exists yet.
   */
  writeStallReport(sessionId: string, task: string, reason: string): string | null {
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const versions = fs.readdirSync(sessionDir).map(f => f.match(/^plan-v(\d+)\.md$/)).filter((m): m is RegExpMatchArray => m !== null).map(m => parseInt(m[1], 10));
    if (versions.length === 0) return null;
    const latest = Math.max(...versions);
    const roundsDone = this.sessionManager.getRoundsDone(sessionId);
    const section = (title: string, file: string): string[] => {
      const content = this.readIfExists(file);
      return content ? [`## ${title}`, '', content.trim(), ''] : [];
    };
    const lines = [
      `# Council stalled: partial result for session ${sessionId}`,
      '',
      '> This document is NOT signed off and NOT approved. No seat agreed to it; `council approve` will refuse it.',
      '> It is the last draft the council produced plus the objections and concerns still open against it, so the',
      '> work spent is not lost: fix the task statement or the draft and open a new session.',
      '',
      `- Reason: ${reason}`,
      `- Rounds completed: ${roundsDone}`,
      `- Latest draft: plan-v${latest}.md`,
      '',
      '## Task',
      '',
      task.trim(),
      '',
      ...(roundsDone > 0 ? section(`Chief Engineer's reply to v${roundsDone} (open objections)`, path.join(sessionDir, roundDirName('round', roundsDone), 'reply.md')) : []),
      ...(roundsDone > 0 ? section(`Chief Architect tie-break rulings on round ${roundsDone}`, path.join(sessionDir, roundDirName('tiebreak', roundsDone), 'reply.md')) : []),
      ...(roundsDone > 0 ? section(`Chief Architect review of v${roundsDone} (concerns)`, path.join(sessionDir, roundDirName('review', roundsDone), 'reply.md')) : []),
      ...(roundsDone > 0 ? section(`Council Lead sign-off notes on v${roundsDone}`, path.join(sessionDir, roundDirName('signoff', roundsDone), 'reply.md')) : []),
      `## Last draft (plan-v${latest}, not approved)`,
      '',
      (this.readIfExists(path.join(sessionDir, `plan-v${latest}.md`)) || '').trim(),
      ''
    ];
    const file = path.join(sessionDir, STALL_REPORT_FILE);
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    this.sessionManager.logEvent(sessionId, `Partial result written: ${STALL_REPORT_FILE} (${reason})`);
    return file;
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

    const prompt = buildLeadDraftPrompt({ sessionId, version, task, previousPlan, feedback, rulings: this.rulings(sessionId), worktreePath: meta.worktreePath, baseSha: meta.baseSha, profile: sessionProfile(meta, this.config) });

    const pmConfig = this.config.seats.lead_pm;
    const adapter = getAdapter(pmConfig.provider);
    const systemPrompt = buildSystemPrompt(this.config, 'lead_pm', null, meta.repoPath);

    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
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

      const { changes, document } = splitLeadReply(recoverSavedDocument(reply));
      try {
        if (changes) this.council.saveDraft(sessionId, 'changes', changes);
        this.council.saveDraft(sessionId, 'plan', document);
        await this.routeQuestions(sessionId, 'lead_pm', `draft v${version}`, path.join(sessionDir, `lead-reply-v${version}${attempt > 1 ? `-attempt${attempt}` : ''}.md`));
        return;
      } catch (err: any) {
        lastError = err.message;
        logger.warn(`Lead PM draft v${version} rejected: ${lastError}`);
        if (attempt === 1) lastError += ' Print the whole document in your reply; a saved file or a summary is not read.';
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
    return buildEngineerRoundPrompt({ sessionId, round, maxRounds: meta.maxRounds, task, plan, changes, feedback, rulings: this.rulings(sessionId), worktreePath: meta.worktreePath, baseSha: meta.baseSha, profile: sessionProfile(meta, this.config) });
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
