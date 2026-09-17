import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { CouncilConfig } from '../types.js';
import { SessionManager } from './session.js';
import { PipelineManager, syncBacklogItem } from './pipeline.js';
import { cloneForExecution } from '../utils/git.js';
import { sha256File } from '../utils/hash.js';
import { projectStateDir } from '../utils/paths.js';
import { buildSystemPrompt } from '../utils/prompts.js';
import { getAdapter } from '../adapters/registry.js';
import { PublishResult, publishBranch } from './publish.js';
import { verifyExecution } from './verification.js';
import { resolveGates, summarizeGates } from './gates.js';
import { ArchitectQuestionEngine, extractArchitectQuestions, formatArchitectRulings } from './questions.js';
import { logger } from '../utils/logger.js';

export type ExecutionOutcome = 'DONE' | 'BLOCKED';

export class ExecutionEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;
  private pipeline: PipelineManager;
  private questions: ArchitectQuestionEngine;

  constructor(config: CouncilConfig, sessionManager?: SessionManager, pipeline?: PipelineManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
    this.pipeline = pipeline || new PipelineManager(path.join(path.dirname(this.sessionManager.sessionsDir), 'backlog'));
    this.questions = new ArchitectQuestionEngine(config, this.sessionManager);
  }

  async handoff(sessionId: string): Promise<string> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'APPROVED') {
      throw new Error(`Cannot handoff session in status '${status.status}'. It must be APPROVED first.`);
    }

    const meta = this.sessionManager.loadMeta(sessionId);
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const prdFile = path.join(sessionDir, 'brief-and-prd.md');
    if (sha256File(prdFile) !== status.details.prdSha256) {
      throw new Error('brief-and-prd.md does not match the approved hash. Refusing handoff.');
    }

    const execBase = path.join(projectStateDir(meta.repoPath), 'exec', sessionId);
    const execBranch = `council/${meta.slug}`;

    logger.council('HARNESS', `Cloning pristine execution checkout: ${execBase} on branch ${execBranch}`);
    await cloneForExecution(meta.repoPath, execBase, execBranch, meta.baseSha);

    if (this.config.project.install_command) {
      logger.council('HARNESS', `Installing project dependencies: ${this.config.project.install_command}`);
      try {
        await execa(this.config.project.install_command, { cwd: execBase, shell: true });
      } catch (err: any) {
        logger.warn(`Dependency install failed (continuing; the Chief Engineer will see the failure): ${err.shortMessage || err.message}`);
      }
    }

    // Files created or changed by the install step are the harness's, not the Chief Engineer's.
    const { stdout: installArtifacts } = await execa('git', ['status', '--porcelain'], { cwd: execBase });

    const packetFile = path.join(execBase, 'COUNCIL_PACKET.md');
    const packetContent = [
      '# Open Councilmen Execution Packet',
      `Session: ${sessionId}`,
      `Base commit: ${meta.baseSha}`,
      `Execution Branch: ${execBranch}`,
      `Approved PRD sha256: ${status.details.prdSha256}`,
      '---',
      fs.readFileSync(prdFile, 'utf8')
    ].join('\n\n');

    fs.writeFileSync(packetFile, packetContent, 'utf8');
    this.sessionManager.setStatus(sessionId, 'IN_EXECUTION', {
      execWorktree: execBase,
      execBranch,
      packetFile,
      installArtifacts: installArtifacts.split('\n').filter(Boolean)
    });
    syncBacklogItem(this.pipeline, meta.backlogItem, 'in-execution', sessionId);

    logger.success(`Handoff ready! Execution checkout: ${execBase}`);
    return execBase;
  }

  /**
   * Runs the Chief Engineer until the work verifies, up to `execution_attempts` runs. A BLOCKED.md is answered by the
   * Chief Architect and a failed verification is fed back to the Chief Engineer — the Operator is never consulted.
   * With skipAgent, only verification and publishing run (e.g. after an environment failure such as a rejected push).
   */
  async run(sessionId: string, options: { skipAgent?: boolean } = {}): Promise<ExecutionOutcome> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const status = this.sessionManager.getStatus(sessionId);
    const hasExecuted = status.details.execWorktree !== undefined;
    if (!(status.status === 'IN_EXECUTION' || (options.skipAgent && status.status === 'BLOCKED' && hasExecuted))) {
      throw new Error(`Cannot run session in status '${status.status}'. ${options.skipAgent ? 'Re-verification needs an IN_EXECUTION or BLOCKED execution.' : 'Run handoff first.'}`);
    }
    const cwd: string | undefined = status.details.execWorktree;
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Execution checkout for session ${sessionId} not found. Run handoff first.`);
    }
    const doneFile = path.join(cwd, 'DONE.md');
    const blockedFile = path.join(cwd, 'BLOCKED.md');
    const gates = resolveGates(this.config);
    const verify = async () => {
      const result = await verifyExecution({
        cwd,
        baseSha: meta.baseSha,
        installArtifacts: status.details.installArtifacts || [],
        gates,
        failFast: this.config.verification?.fail_fast
      });
      this.recordVerification(sessionId, result);
      return result;
    };

    if (options.skipAgent) {
      if (!fs.existsSync(doneFile)) return this.block(sessionId, meta.backlogItem, 'No DONE.md in the execution checkout.');
      const check = await verify();
      return check.ok ? this.publish(sessionId) : this.block(sessionId, meta.backlogItem, check.reason);
    }

    const maxAttempts = Math.max(1, this.config.council.execution_attempts);
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Archive earlier reports outside the clone, so they never show up as uncommitted work.
      const archive = path.join(this.sessionManager.getSessionPath(sessionId), 'execution-reports');
      for (const f of [doneFile, blockedFile]) {
        if (!fs.existsSync(f)) continue;
        fs.mkdirSync(archive, { recursive: true });
        fs.renameSync(f, path.join(archive, `${path.basename(f, '.md')}-before-attempt-${attempt}-${Date.now()}.md`));
      }
      const isLast = attempt === maxAttempts;
      try {
        await this.runEngineer(sessionId, cwd, attempt, maxAttempts, feedback);
      } catch (err: any) {
        const reason = `Chief Engineer run failed: ${err.shortMessage || err.message}`;
        if (isLast) return this.block(sessionId, meta.backlogItem, reason);
        feedback = ['## Your previous run failed', reason];
        continue;
      }

      if (fs.existsSync(blockedFile)) {
        const blocked = fs.readFileSync(blockedFile, 'utf8');
        if (isLast) return this.block(sessionId, meta.backlogItem, `Chief Engineer still BLOCKED after ${maxAttempts} attempts. See ${blockedFile}`);
        const questions = extractArchitectQuestions(blocked);
        const prd = fs.readFileSync(path.join(this.sessionManager.getSessionPath(sessionId), 'brief-and-prd.md'), 'utf8');
        await this.questions.ask(sessionId, 'chief_engineer', `execution attempt ${attempt}`, questions.length > 0 ? questions : [blocked.trim()],
          `### Approved PRD (scope is fixed)\n${prd}\n\n### BLOCKED.md\n${blocked}`);
        feedback = ['## Your BLOCKED.md was ruled on by the Chief Architect (see rulings above). Continue within the approved scope.', blocked];
        continue;
      }
      if (!fs.existsSync(doneFile)) {
        if (isLast) return this.block(sessionId, meta.backlogItem, 'Chief Engineer finished without writing DONE.md or BLOCKED.md.');
        feedback = ['## Your previous run ended without DONE.md or BLOCKED.md. Finish the work and write one of them.'];
        continue;
      }
      const check = await verify();
      if (check.ok) return this.publish(sessionId);
      if (isLast) return this.block(sessionId, meta.backlogItem, check.reason);
      feedback = ['## Harness verification of your DONE.md failed — fix it, commit, and write DONE.md again', check.reason];
    }
    return this.block(sessionId, meta.backlogItem, 'Execution attempts exhausted.');
  }

  private async runEngineer(sessionId: string, cwd: string, attempt: number, maxAttempts: number, feedback: string[]): Promise<void> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const branch: string = this.sessionManager.getStatus(sessionId).details.execBranch || `council/${meta.slug}`;
    const engineer = this.config.seats.chief_engineer;
    logger.council('CHIEF ENGINEER', `Autonomous execution attempt ${attempt}/${maxAttempts} in ${cwd}...`);
    const prompt = [
      'Implement the approved specification below to completion, following the execution contract.',
      `You are on branch ${branch} in an isolated clone. Commit your work to this branch with clear messages. Do not push and do not open a pull request: the harness does that after verifying your work.`,
      'Write reproduction tests before applying fixes.',
      'When fully finished, write DONE.md. If a rule you need is undefined, write BLOCKED.md containing `QUESTION FOR ARCHITECT: <question>` lines; the Chief Architect answers and you will be resumed.',
      '',
      ...formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId)),
      ...feedback,
      '',
      fs.readFileSync(path.join(cwd, 'COUNCIL_PACKET.md'), 'utf8')
    ].join('\n');

    this.sessionManager.setActivity('chief_engineer', 'busy', `Executing ${meta.slug} (attempt ${attempt})`);
    try {
      await getAdapter(engineer.provider).runPrompt(prompt, {
        cwd,
        model: engineer.model,
        permissionMode: 'auto',
        systemPrompt: buildSystemPrompt(this.config, 'chief_engineer', 'execution', meta.repoPath),
        timeoutSeconds: this.config.council.execution_timeout_seconds
      });
    } finally {
      this.sessionManager.setActivity('chief_engineer', 'idle', 'Ready');
    }
  }

  /** Immutable evidence of what the harness checked, kept with the session (SOC 2 CC8.1 audit trail). */
  private recordVerification(sessionId: string, result: Awaited<ReturnType<typeof verifyExecution>>): void {
    const dir = path.join(this.sessionManager.getSessionPath(sessionId), 'verification');
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      verifiedAt: new Date().toISOString(),
      headSha: result.headSha,
      passed: result.ok,
      reason: result.ok ? undefined : result.reason,
      gates: result.gates
    };
    fs.writeFileSync(path.join(dir, `report-${Date.now()}.json`), JSON.stringify(record, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(record, null, 2), 'utf8');
    this.sessionManager.setStatus(sessionId, this.sessionManager.getStatus(sessionId).status, {
      // Gate output is deliberately left in the session evidence file, never in status (it can be large and noisy).
      verification: {
        passed: result.ok,
        headSha: result.headSha,
        gates: result.gates.map(({ output, ...summary }) => summary)
      }
    });
    this.sessionManager.logEvent(sessionId, `Verification ${result.ok ? 'passed' : 'failed'} at ${result.headSha}: ${result.gates.map(g => `${g.name}=${g.passed ? 'pass' : 'fail'}`).join(', ') || 'no gates'}`);
  }

  private async publish(sessionId: string): Promise<ExecutionOutcome> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const status = this.sessionManager.getStatus(sessionId);
    const gateSummary = summarizeGates(status.details.verification?.gates || []);
    let published: PublishResult;
    try {
      published = await publishBranch({
        cwd: status.details.execWorktree,
        branch: status.details.execBranch || `council/${meta.slug}`,
        baseBranch: this.config.project.base_branch,
        title: `[Council] ${meta.slug}`,
        body: [
          `Automated PR generated from Open Councilmen session ${sessionId}.`,
          '',
          `Approved PRD sha256: ${status.details.prdSha256}`,
          `Signed off by: ${(status.details.signedOffBy || []).join(', ') || 'n/a'}`,
          '',
          '## Harness verification',
          gateSummary
        ].join('\n'),
        autoMerge: this.config.backlog.auto_merge_dev
      });
    } catch (err: any) {
      return this.block(sessionId, meta.backlogItem, `Push or pull request creation failed: ${err.shortMessage || err.message}\n${err.stderr || ''}`);
    }
    this.sessionManager.setStatus(sessionId, 'DONE', { prUrl: published.prUrl, autoMerge: published.autoMerge, completedAt: new Date().toISOString() });
    syncBacklogItem(this.pipeline, meta.backlogItem, 'done', sessionId);
    return 'DONE';
  }

  private block(sessionId: string, backlogItem: string | undefined, reason: string): ExecutionOutcome {
    logger.warn(reason);
    this.sessionManager.setStatus(sessionId, 'BLOCKED', { blockedReason: reason });
    syncBacklogItem(this.pipeline, backlogItem, 'parked', sessionId);
    return 'BLOCKED';
  }
}
