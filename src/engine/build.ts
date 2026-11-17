import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { CouncilConfig, GateResult } from '../types.js';
import { SessionManager } from './session.js';
import { cloneForExecution, getHeadSha, isGitRepo } from '../utils/git.js';
import { projectStateDir } from '../utils/paths.js';
import { SeatName } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import { resolveGates, summarizeGates } from './gates.js';
import { verifyExecution } from './verification.js';
import { publishBranch } from './publish.js';
import { SEAT_LABELS, describeSeatError, runSeat, vendorOf } from './seats.js';
import { RISK_LEDGER_FILE, buildPrompt, riskPrompt, riskTestPrompt } from './build-prompts.js';
import { Risk, RiskOutcome, TEST_PATH, checkLedger, ledgerTable, parseRiskList, saysNoRisks, skippedTests } from './build-risks.js';

export const BUILD_DEFAULTS = { risk_rounds: 1, risks_per_seat: 5, risk_timeout_seconds: 600 };
export const MAX_RISK_ROUNDS = 3;
/** The diff each seat gets inline; past this it reads the rest from its checkout. */
export const MAX_RISK_DIFF_CHARS = 60_000;
export const BUILD_REPORT_FILE = 'build-report.md';
/** The seats that name risks, in the order their lists are numbered. */
export const RISK_SEATS: SeatName[] = ['chief_engineer', 'lead_pm', 'chief_architect'];

export interface BuildOptions {
  task: string;
  slug: string;
  /** Push the branch and open a pull request once everything passes. */
  publish?: boolean;
  /** Copy the finished branch into the user's repository as a local branch (no checkout, nothing pushed). Default true. */
  fetchBranch?: boolean;
}

export interface BuildGap { seat: SeatName; round: number; reason: string }

export interface BuildOutcome {
  outcome: 'DONE' | 'BLOCKED';
  sessionId: string;
  worktree: string;
  branch: string;
  risks: Risk[];
  outcomes: RiskOutcome[];
  gaps: BuildGap[];
  reason?: string;
  prUrl?: string;
  /** The local branch the result was copied to in the user's repository, if it was. */
  localBranch?: string;
  report: string;
  seconds: number;
}

interface CheckResult { ok: boolean; problems: string[]; outcomes: RiskOutcome[]; gates: GateResult[]; headSha: string }

/**
 * `council build`: one agent builds, the three seats name what could still be wrong, and every risk they name becomes a
 * test the build must pass. A risk ends one of two ways: a test that tags its id and runs in the project's test command,
 * or a rejection that quotes, word for word, the task or a file of the repository that contradicts it. "Later", "out of
 * scope" and "unlikely" are not ways out. The harness, not a model, checks the ledger, the gates and the absence of
 * skipped tests before anything is published.
 *
 * Why: in the November 2026 full-loop benchmark the council's own plan named the bug a hidden test later caught (a
 * renewal retried the next day is charged twice) in 3 of 3 runs, and then deferred it each time, while one agent alone
 * missed it every time. The debate around a plan cost 68 minutes a run and lost to one agent on everything else.
 */
export class BuildEngine {
  private config: CouncilConfig;
  readonly sessions: SessionManager;

  constructor(config: CouncilConfig, sessions?: SessionManager, repoPath?: string) {
    this.config = config;
    this.sessions = sessions || new SessionManager(path.join(projectStateDir(repoPath), 'builds'));
  }

  private get settings() {
    const b = this.config.build || {};
    return {
      riskRounds: Math.min(MAX_RISK_ROUNDS, Math.max(1, Math.floor(b.risk_rounds ?? BUILD_DEFAULTS.risk_rounds))),
      risksPerSeat: Math.max(1, Math.floor(b.risks_per_seat ?? BUILD_DEFAULTS.risks_per_seat)),
      riskTimeout: b.risk_timeout_seconds ?? BUILD_DEFAULTS.risk_timeout_seconds,
      attempts: Math.max(1, Math.floor(b.attempts ?? this.config.council.execution_attempts ?? 3))
    };
  }

  async run(repoPath: string, options: BuildOptions): Promise<BuildOutcome> {
    const started = Date.now();
    const repo = path.resolve(repoPath);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(options.slug)) throw new Error(`Invalid slug '${options.slug}'. Use lowercase letters, digits and dashes.`);
    if (!(await isGitRepo(repo))) throw new Error(`${repo} is not a git repository.`);
    if (!options.task.trim()) throw new Error('council build needs a task: a sentence, or --task-file.');
    const gates = resolveGates(this.config);
    if (gates.length === 0) {
      throw new Error('council build needs a test command: every risk becomes a test, and something has to run them. Set project.test_command (or verification.gates) in .council/config.yml.');
    }
    const testCommand = gates.map(g => g.command).join(' && ');

    const sessionId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${options.slug}`;
    const baseSha = await getHeadSha(repo);
    const worktree = path.join(projectStateDir(repo), 'exec', sessionId);
    const branch = `council/${options.slug}`;
    this.sessions.createSession({
      id: sessionId, slug: options.slug, repoPath: repo, worktreePath: worktree, baseRef: this.config.project.base_branch || 'main',
      baseSha, maxRounds: this.settings.riskRounds, tiebreakRound: 0, createdAt: new Date().toISOString()
    });
    this.sessions.saveTask(sessionId, options.task);
    const dir = this.sessions.getSessionPath(sessionId);
    const vendors = [...new Set(RISK_SEATS.map(s => vendorOf(this.config.seats[s].provider)))];
    logger.council('HARNESS', `Build ${sessionId}: ${SEAT_LABELS.chief_engineer} builds on ${vendorOf(this.config.seats.chief_engineer.provider)} (${this.config.seats.chief_engineer.model}); risks from ${RISK_SEATS.map(s => `${vendorOf(this.config.seats[s].provider)} (${this.config.seats[s].model})`).join(', ')}.`);
    if (vendors.length < 3) logger.warn(`Only ${vendors.length} AI compan${vendors.length === 1 ? 'y' : 'ies'} (${vendors.join(', ')}) will name risks. Three different ones see the most; \`council doctor\` shows what is missing.`);

    logger.council('HARNESS', `Cloning an isolated checkout: ${worktree} on branch ${branch}`);
    await cloneForExecution(repo, worktree, branch, baseSha);
    fs.appendFileSync(path.join(worktree, '.git', 'info', 'exclude'), `${RISK_LEDGER_FILE}\n`, 'utf8');
    if (this.config.project.install_command) {
      logger.council('HARNESS', `Installing dependencies: ${this.config.project.install_command}`);
      try { await execa(this.config.project.install_command, { cwd: worktree, shell: true }); } catch (err: any) {
        logger.warn(`Dependency install failed (continuing; the builder will see the failure): ${err.shortMessage || err.message}`);
      }
    }
    const { stdout: porcelain } = await execa('git', ['status', '--porcelain'], { cwd: worktree });
    const installArtifacts = porcelain.split('\n').filter(Boolean);
    this.sessions.setStatus(sessionId, 'IN_EXECUTION', { mode: 'build', execWorktree: worktree, execBranch: branch, installArtifacts });

    const ctx = { sessionId, dir, repo, worktree, branch, baseSha, task: options.task, testCommand, installArtifacts, gates };
    const risks: Risk[] = [];
    let outcomes: RiskOutcome[] = [];
    const gaps: BuildGap[] = [];
    const timings: Record<string, number> = {};
    const finish = (outcome: 'DONE' | 'BLOCKED', reason?: string, extra: Partial<BuildOutcome> = {}): BuildOutcome => {
      const seconds = Math.round((Date.now() - started) / 1000);
      const report = this.writeReport(ctx, risks, outcomes, gaps, outcome, reason, seconds, extra.prUrl);
      this.sessions.setStatus(sessionId, outcome, {
        ...(reason ? { blockedReason: reason } : {}), seconds, timings, report,
        risks: risks.length, tested: outcomes.filter(o => o.status === 'tested').length,
        rejected: outcomes.filter(o => o.status === 'rejected').length, missing: outcomes.filter(o => o.status === 'missing').length,
        gaps: gaps.map(g => `${SEAT_LABELS[g.seat]} round ${g.round}: ${g.reason}`),
        ...(extra.prUrl ? { prUrl: extra.prUrl } : {}), ...(extra.localBranch ? { localBranch: extra.localBranch } : {})
      });
      if (outcome === 'BLOCKED') logger.warn(`Build blocked: ${reason}`);
      return { outcome, sessionId, worktree, branch, risks, outcomes, gaps, reason, report, seconds, ...extra };
    };

    // 1. Build: one agent, the task as given.
    let t = Date.now();
    logger.council('CHIEF ENGINEER', 'Building...');
    try {
      const reply = await runSeat(this.config, this.sessions, sessionId, 'chief_engineer', 'build', buildPrompt({ task: options.task, branch, testCommand, installArtifacts: this.artifactPaths(installArtifacts) }), {
        cwd: worktree, permissionMode: 'auto', timeoutSeconds: this.config.council.execution_timeout_seconds
      });
      fs.writeFileSync(path.join(dir, 'build.md'), reply, 'utf8');
    } catch (err: any) {
      return finish('BLOCKED', `The builder failed: ${describeSeatError(err).reason}`);
    }
    await this.commitLeftovers(ctx, 'Build');
    timings.buildSeconds = Math.round((Date.now() - t) / 1000);
    if (!(await this.hasCommits(ctx))) return finish('BLOCKED', 'The builder made no change to the repository.');

    // 2. Risk rounds: the three seats name risks; the builder turns every one into a passing test.
    for (let round = 1; round <= this.settings.riskRounds; round++) {
      t = Date.now();
      const fresh = await this.riskRound(ctx, round, risks, outcomes, gaps);
      timings[`risks${round}Seconds`] = Math.round((Date.now() - t) / 1000);
      risks.push(...fresh);
      fs.writeFileSync(path.join(dir, 'risks.json'), JSON.stringify(risks, null, 2), 'utf8');
      if (fresh.length === 0 && round > 1) break;

      t = Date.now();
      const settled = await this.settle(ctx, round, risks, fresh);
      timings[`tests${round}Seconds`] = Math.round((Date.now() - t) / 1000);
      outcomes = settled.outcomes;
      fs.writeFileSync(path.join(dir, 'outcomes.json'), JSON.stringify(outcomes, null, 2), 'utf8');
      if (!settled.ok) return finish('BLOCKED', `Not every risk ended as a passing test or a quoted rejection after ${this.settings.attempts} tries:\n${settled.problems.join('\n')}`);
      if (fresh.length === 0) break;
    }

    // 3. Deliver: a pull request when asked, and the branch in the user's own repository.
    let localBranch: string | undefined;
    if (options.fetchBranch !== false) localBranch = await this.fetchInto(ctx);
    if (options.publish) {
      try {
        const published = await publishBranch({
          cwd: worktree, branch, baseBranch: this.config.project.base_branch, title: `[Council] ${options.slug}`,
          body: this.prBody(ctx, risks, outcomes, gaps), autoMerge: false // `council build --pr` opens a pull request for a person to merge; it never turns on auto-merge
        });
        return finish('DONE', undefined, { prUrl: published.prUrl, localBranch });
      } catch (err: any) {
        return finish('BLOCKED', `Everything passed, but the push or the pull request failed: ${err.shortMessage || err.message}`, { localBranch });
      }
    }
    return finish('DONE', undefined, { localBranch });
  }

  /** One risk round: the seats answer in parallel, each in a read-only look at the built checkout. */
  private async riskRound(ctx: BuildContext, round: number, known: Risk[], outcomes: RiskOutcome[], gaps: BuildGap[]): Promise<Risk[]> {
    const { stdout: diffAll } = await execa('git', ['diff', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree, maxBuffer: 256 * 1024 * 1024 });
    const { stdout: names } = await execa('git', ['diff', '--name-only', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree });
    const diffTruncated = diffAll.length > MAX_RISK_DIFF_CHARS;
    const roundDir = path.join(ctx.dir, `risks-${String(round).padStart(2, '0')}`);
    fs.mkdirSync(roundDir, { recursive: true });
    const byId = new Map(outcomes.map(o => [o.id, o]));
    const prompt = riskPrompt({
      task: ctx.task, diff: diffTruncated ? diffAll.slice(0, MAX_RISK_DIFF_CHARS) : diffAll, diffTruncated,
      files: names.split('\n').filter(Boolean), testCommand: ctx.testCommand, limit: this.settings.risksPerSeat, round,
      earlier: known.map(risk => ({ risk, outcome: byId.get(risk.id) }))
    });
    fs.writeFileSync(path.join(roundDir, 'prompt.md'), prompt, 'utf8');
    logger.council('HARNESS', `Risk round ${round}: ${RISK_SEATS.map(s => SEAT_LABELS[s]).join(', ')} read the change in parallel...`);
    const untrackedBefore = new Set(await this.untracked(ctx));
    const answers = await Promise.all(RISK_SEATS.map(async seat => {
      try {
        const reply = await runSeat(this.config, this.sessions, ctx.sessionId, seat, `risks round ${round}`, prompt, {
          cwd: ctx.worktree, permissionMode: 'plan', timeoutSeconds: this.settings.riskTimeout
        });
        fs.writeFileSync(path.join(roundDir, `${seat}.md`), reply, 'utf8');
        return { seat, vendor: vendorOf(this.config.seats[seat].provider), reply };
      } catch (err: any) {
        const reason = describeSeatError(err).reason;
        gaps.push({ seat, round, reason });
        fs.writeFileSync(path.join(roundDir, `${seat}.failed.txt`), reason, 'utf8');
        this.sessions.logEvent(ctx.sessionId, `${SEAT_LABELS[seat]} named no risks in round ${round}: ${reason}`);
        logger.warn(`${SEAT_LABELS[seat]} (${vendorOf(this.config.seats[seat].provider)}) ${reason}; going on with the other seats' risks.`);
        return null;
      }
    }));
    // A read-only seat must not have changed the checkout; if one did anyway, its edits and new files are dropped,
    // so nothing a reviewer wrote can be committed later with the builder's work.
    const { stdout: touched } = await execa('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ctx.worktree });
    if (touched.trim()) {
      logger.warn(`A seat changed tracked files during the risk round; dropping those edits:\n${touched}`);
      await execa('git', ['checkout', '--', '.'], { cwd: ctx.worktree });
    }
    const added = (await this.untracked(ctx)).filter(f => !untrackedBefore.has(f) && f !== RISK_LEDGER_FILE);
    if (added.length) {
      logger.warn(`A seat created files during the risk round; removing them: ${added.join(', ')}`);
      for (const f of added) fs.rmSync(path.join(ctx.worktree, f), { force: true });
    }
    const fresh: Risk[] = [];
    let next = known.length + 1;
    for (const answer of answers) {
      if (!answer) continue;
      const list = parseRiskList(answer.reply, this.settings.risksPerSeat);
      if (list.length === 0 && !saysNoRisks(answer.reply)) {
        gaps.push({ seat: answer.seat, round, reason: 'answered without a single RISK/WHEN/EXPECT block' });
      }
      for (const item of list) fresh.push({ id: `R${next++}`, seat: answer.seat, vendor: answer.vendor, round, ...item });
    }
    logger.council('HARNESS', `Risk round ${round}: ${fresh.length} risk${fresh.length === 1 ? '' : 's'} (${answers.filter(Boolean).map(a => `${a!.vendor} ${fresh.filter(r => r.seat === a!.seat).length}`).join(', ')}).`);
    this.sessions.logEvent(ctx.sessionId, `Risk round ${round}: ${fresh.map(r => `${r.id} (${r.vendor}) ${r.title}`).join('; ') || 'no risks'}`);
    return fresh;
  }

  /**
   * Has the builder turn the new risks into tests and fix the code until the ledger, the gates and the no-skip rule all
   * hold, feeding back exactly what the harness found, for at most `attempts` builder runs.
   */
  private async settle(ctx: BuildContext, round: number, risks: Risk[], fresh: Risk[]): Promise<CheckResult> {
    let feedback: string[] = [];
    let check = null as CheckResult | null;
    let owed = fresh;
    let attempt = 0;
    while (true) {
      if (owed.length > 0 || check) {
        if (attempt >= this.settings.attempts) break;
        attempt++;
        logger.council('CHIEF ENGINEER', `Round ${round}, try ${attempt}/${this.settings.attempts}: ${owed.length} risk${owed.length === 1 ? '' : 's'} to turn into tests${check ? ', plus what the harness found' : ''}...`);
        try {
          const reply = await runSeat(this.config, this.sessions, ctx.sessionId, 'chief_engineer', `risk tests round ${round} try ${attempt}`,
            riskTestPrompt({ risks: owed.length ? owed : risks, testCommand: ctx.testCommand, branch: ctx.branch, feedback }), {
              cwd: ctx.worktree, permissionMode: 'auto', timeoutSeconds: this.config.council.execution_timeout_seconds
            });
          fs.writeFileSync(path.join(ctx.dir, `tests-${String(round).padStart(2, '0')}-try${attempt}.md`), reply, 'utf8');
        } catch (err: any) {
          feedback = ['## Your previous run failed', describeSeatError(err).reason];
          check = { ok: false, problems: [`the builder's run failed: ${describeSeatError(err).reason}`], outcomes: check?.outcomes || [], gates: [], headSha: '' };
          continue;
        }
        await this.commitLeftovers(ctx, `Risk tests (round ${round})`);
      }
      check = await this.check(ctx, risks);
      if (check.ok) return check;
      // Retry with every risk that is still not settled, and the harness's findings word for word.
      const missing = new Set(check.outcomes.filter(o => o.status === 'missing').map(o => o.id));
      owed = risks.filter(r => missing.has(r.id));
      feedback = ['## The harness checked your work and it is not done. Fix every point below, commit, and finish again.', ...check.problems.map(p => `- ${p}`)];
      logger.warn(`Harness check failed:\n${check.problems.map(p => `  - ${p.split('\n')[0]}`).join('\n')}`);
    }
    return check || { ok: false, problems: ['nothing was checked'], outcomes: [], gates: [], headSha: '' };
  }

  /** Every mechanical condition the build must meet, checked by the harness itself. */
  private async check(ctx: BuildContext, risks: Risk[]): Promise<CheckResult> {
    const outputs: string[] = [];
    const verification = await verifyExecution({
      cwd: ctx.worktree, baseSha: ctx.baseSha, installArtifacts: ctx.installArtifacts, gates: ctx.gates,
      onOutput: (_gate, output) => outputs.push(output)
    });
    this.recordVerification(ctx, verification);
    const problems: string[] = [];
    if (!verification.ok) problems.push(verification.reason);

    const { stdout: diff } = await execa('git', ['diff', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree, maxBuffer: 256 * 1024 * 1024 });
    const skipped = skippedTests(diff);
    if (skipped.length) problems.push(`Tests may not be skipped or marked todo; remove these markers and make the tests pass:\n${skipped.map(s => `  ${s}`).join('\n')}`);
    const { stdout: deleted } = await execa('git', ['diff', '--name-only', '--diff-filter=D', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree });
    const deletedTests = deleted.split('\n').filter(f => f && TEST_PATH.test(f));
    if (deletedTests.length) problems.push(`Test files the project already had were deleted; restore them: ${deletedTests.join(', ')}`);

    const { stdout: changed } = await execa('git', ['diff', '--name-only', '--diff-filter=AMR', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree });
    const testFiles = changed.split('\n').filter(f => f && TEST_PATH.test(f)).map(f => ({ path: f, content: this.readText(path.join(ctx.worktree, f)) }));
    const ledgerFile = path.join(ctx.worktree, RISK_LEDGER_FILE);
    const ledger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : '';
    if (ledger) fs.writeFileSync(path.join(ctx.dir, RISK_LEDGER_FILE), ledger, 'utf8');
    const outcomes = checkLedger({ risks, ledger, testFiles, quotable: await this.quotable(ctx), gateOutput: outputs.join('\n') });
    for (const o of outcomes) if (o.status === 'missing') problems.push(`${o.id}: ${o.reason}`);
    return { ok: problems.length === 0, problems, outcomes, gates: verification.gates, headSha: verification.headSha };
  }

  private quotableCache: Array<{ source: string; text: string }> | null = null;

  /** The task, and every text file tracked at the base commit: what a rejection may quote. */
  private async quotable(ctx: BuildContext): Promise<Array<{ source: string; text: string }>> {
    if (this.quotableCache) return this.quotableCache;
    const out = [{ source: 'task', text: ctx.task }];
    const { stdout } = await execa('git', ['ls-tree', '-r', '-l', ctx.baseSha], { cwd: ctx.worktree, maxBuffer: 64 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      const m = /^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/.exec(line);
      if (!m || +m[1] > 512 * 1024 || /(^|\/)(node_modules|dist|vendor)\//.test(m[2])) continue;
      const { stdout: text } = await execa('git', ['show', `${ctx.baseSha}:${m[2]}`], { cwd: ctx.worktree, maxBuffer: 2 * 1024 * 1024, reject: false });
      if (text && !text.includes('\u0000')) out.push({ source: m[2], text });
    }
    this.quotableCache = out;
    return out;
  }

  private readText(file: string): string {
    try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
  }

  private artifactPaths(porcelain: string[]): string[] {
    return porcelain.map(line => line.slice(3).trim()).filter(Boolean);
  }

  /** Commits whatever the builder left uncommitted (never the install step's files), so the gates test what ships. */
  private async commitLeftovers(ctx: BuildContext, what: string): Promise<void> {
    const harness = new Set(ctx.installArtifacts);
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: ctx.worktree });
    const paths = stdout.split('\n').filter(l => l && !harness.has(l)).map(l => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
    if (paths.length === 0) return;
    await execa('git', ['add', '-A', '--', ...paths], { cwd: ctx.worktree });
    await execa('git', ['-c', 'user.name=Open Council', '-c', 'user.email=council@localhost', 'commit', '-q', '--no-verify', '-m', `${what}: changes the builder left uncommitted`], { cwd: ctx.worktree, reject: false });
    this.sessions.logEvent(ctx.sessionId, `Committed ${paths.length} file(s) the builder left uncommitted (${what}).`);
  }

  /** Untracked, not ignored files in the checkout, relative to its root. */
  private async untracked(ctx: BuildContext): Promise<string[]> {
    const { stdout } = await execa('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: ctx.worktree });
    return stdout.split('\0').filter(Boolean);
  }

  private async hasCommits(ctx: BuildContext): Promise<boolean> {
    const { stdout } = await execa('git', ['rev-list', '--count', `${ctx.baseSha}..HEAD`], { cwd: ctx.worktree });
    return parseInt(stdout.trim(), 10) > 0;
  }

  /** Copies the finished branch into the user's repository as a local branch. Their checkout and working tree are untouched. */
  private async fetchInto(ctx: BuildContext): Promise<string | undefined> {
    let name = ctx.branch;
    const exists = async (n: string) => (await execa('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${n}`], { cwd: ctx.repo, reject: false })).exitCode === 0;
    for (let i = 2; await exists(name); i++) name = `${ctx.branch}-${i}`;
    const r = await execa('git', ['fetch', '--quiet', ctx.worktree, `${ctx.branch}:refs/heads/${name}`], { cwd: ctx.repo, reject: false });
    if (r.exitCode !== 0) {
      logger.warn(`Could not copy the branch into your repository (${(r.stderr || '').trim().split('\n').pop()}). It is in ${ctx.worktree}.`);
      return undefined;
    }
    return name;
  }

  private recordVerification(ctx: BuildContext, result: Awaited<ReturnType<typeof verifyExecution>>): void {
    const dir = path.join(ctx.dir, 'verification');
    fs.mkdirSync(dir, { recursive: true });
    const record = { verifiedAt: new Date().toISOString(), headSha: result.headSha, passed: result.ok, reason: result.ok ? undefined : result.reason, gates: result.gates };
    fs.writeFileSync(path.join(dir, `report-${Date.now()}.json`), JSON.stringify(record, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(record, null, 2), 'utf8');
  }

  private prBody(ctx: BuildContext, risks: Risk[], outcomes: RiskOutcome[], gaps: BuildGap[]): string {
    let gates: GateResult[] = [];
    try { gates = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'verification', 'latest.json'), 'utf8')).gates || []; } catch { /* no record */ }
    return [
      `Built by Open Council (\`council build\`, session ${ctx.sessionId}).`,
      '',
      'One agent built the change. Three AIs from different companies then named what could still be wrong, and every risk they named became a test this branch passes, or was rejected with a quote from the task or the repository that contradicts it.',
      '',
      '## Risks',
      ledgerTable(risks, outcomes),
      ...(gaps.length ? ['', '## Gaps', ...gaps.map(g => `- ${SEAT_LABELS[g.seat]} (${vendorOf(this.config.seats[g.seat].provider)}), round ${g.round}: ${g.reason}`)] : []),
      '',
      '## Harness verification',
      summarizeGates(gates)
    ].join('\n');
  }

  private writeReport(ctx: BuildContext, risks: Risk[], outcomes: RiskOutcome[], gaps: BuildGap[], outcome: string, reason: string | undefined, seconds: number, prUrl?: string): string {
    const file = path.join(ctx.dir, BUILD_REPORT_FILE);
    const lines = [
      `# Council build ${ctx.sessionId}: ${outcome}`,
      '',
      `- Took: ${Math.floor(seconds / 60)} min ${seconds % 60} s`,
      `- Branch: ${ctx.branch} in ${ctx.worktree}`,
      ...(prUrl ? [`- Pull request: ${prUrl}`] : []),
      ...(reason ? [`- Why it stopped: ${reason}`] : []),
      '',
      '## Task',
      '',
      ctx.task.trim(),
      '',
      '## Risks',
      '',
      ledgerTable(risks, outcomes),
      '',
      ...risks.flatMap(r => [`### ${r.id} (${r.vendor}, round ${r.round}): ${r.title}`, '', `- When: ${r.when}`, `- Expect: ${r.expect}`, `- Where: ${r.where}`, '']),
      ...(gaps.length ? ['## Gaps', '', ...gaps.map(g => `- ${SEAT_LABELS[g.seat]} (${vendorOf(this.config.seats[g.seat].provider)}), round ${g.round}: ${g.reason}`), ''] : [])
    ];
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return file;
  }
}

interface BuildContext {
  sessionId: string;
  dir: string;
  repo: string;
  worktree: string;
  branch: string;
  baseSha: string;
  task: string;
  testCommand: string;
  installArtifacts: string[];
  gates: ReturnType<typeof resolveGates>;
}
