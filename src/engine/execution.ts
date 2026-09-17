import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import execa from 'execa';
import { CouncilConfig } from '../types.js';
import { SessionManager } from './session.js';
import { cloneForExecution } from '../utils/git.js';
import { sha256File } from '../utils/hash.js';
import { getAdapter } from '../adapters/registry.js';
import { logger } from '../utils/logger.js';

export class ExecutionEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async handoff(sessionId: string): Promise<string> {
    const status = this.sessionManager.getStatus(sessionId);
    if (status.status !== 'APPROVED') {
      throw new Error(`Cannot handoff session in status '${status.status}'. It must be APPROVED first.`);
    }

    const meta = this.sessionManager.loadMeta(sessionId);
    const execBase = path.join(os.homedir(), '.councilmen', 'exec', `${meta.slug}`);
    const execBranch = `council/${meta.slug}`;

    logger.council('HARNESS', `Cloning pristine execution worktree: ${execBase} on branch ${execBranch}`);
    await cloneForExecution(meta.repoPath, execBase, execBranch, meta.baseSha);

    // Install dependencies
    if (this.config.project.install_command) {
      logger.council('HARNESS', `Installing project dependencies: ${this.config.project.install_command}`);
      try {
        const [cmd, ...args] = this.config.project.install_command.split(' ');
        await execa(cmd, args, { cwd: execBase });
      } catch (err: any) {
        logger.warn(`Dependency install finished with note: ${err.message}`);
      }
    }

    // Prepare packet
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const prdFile = path.join(sessionDir, 'brief-and-prd.md');
    const packetFile = path.join(execBase, 'COUNCIL_PACKET.md');

    const prdText = fs.readFileSync(prdFile, 'utf8');
    const packetContent = [
      '# Open Councilmen Execution Packet',
      `Session: ${sessionId}`,
      `Base commit: ${meta.baseSha}`,
      `Execution Branch: ${execBranch}`,
      '---',
      prdText
    ].join('\n\n');

    fs.writeFileSync(packetFile, packetContent, 'utf8');
    this.sessionManager.setStatus(sessionId, 'IN_EXECUTION', {
      execWorktree: execBase,
      execBranch,
      packetFile
    });

    logger.success(`Handoff ready! Worktree: ${execBase}`);
    return execBase;
  }

  async run(sessionId: string): Promise<'DONE' | 'BLOCKED'> {
    const meta = this.sessionManager.loadMeta(sessionId);
    const status = this.sessionManager.getStatus(sessionId);
    const execWorktree = status.details?.execWorktree;
    if (!execWorktree || !fs.existsSync(execWorktree)) {
      throw new Error(`Execution worktree for session ${sessionId} not found. Run handoff first.`);
    }

    const packetFile = path.join(execWorktree, 'COUNCIL_PACKET.md');
    const packetText = fs.readFileSync(packetFile, 'utf8');

    const engineerConfig = this.config.seats.chief_engineer;
    const adapter = getAdapter(engineerConfig.provider);

    logger.council('CHIEF ENGINEER', `Beginning autonomous execution in ${execWorktree}...`);

    const prompt = [
      'Implement the attached approved specification to completion.',
      'Follow repository standards. Write reproduction tests before applying fixes.',
      'When fully finished, write DONE.md. If blocked by an unsettled ambiguity, write BLOCKED.md.',
      '',
      packetText
    ].join('\n');

    await adapter.runPrompt(prompt, {
      cwd: execWorktree,
      model: engineerConfig.model,
      permissionMode: 'auto',
      timeoutSeconds: 3600 // 1 hour execution window
    });

    const doneFile = path.join(execWorktree, 'DONE.md');
    const blockedFile = path.join(execWorktree, 'BLOCKED.md');

    if (fs.existsSync(doneFile)) {
      logger.success(`Chief Engineer completed implementation! (Found DONE.md)`);

      // Verify test suite
      if (this.config.project.test_command) {
        logger.council('HARNESS', `Verifying regression test suite: ${this.config.project.test_command}`);
        const [tCmd, ...tArgs] = this.config.project.test_command.split(' ');
        await execa(tCmd, tArgs, { cwd: execWorktree });
      }

      // Create Pull Request
      try {
        const branch = status.details?.execBranch || `council/${meta.slug}`;
        await execa('git', ['push', '-u', 'origin', branch], { cwd: execWorktree });
        await execa('gh', ['pr', 'create', '--title', `[Council] ${meta.slug}`, '--body', `Automated PR generated from Open Councilmen session ${sessionId}`], { cwd: execWorktree });
        logger.success(`Pull Request created successfully!`);
      } catch (err: any) {
        logger.warn(`Git push/PR note: ${err.message}`);
      }

      this.sessionManager.setStatus(sessionId, 'DONE');
      return 'DONE';
    } else if (fs.existsSync(blockedFile)) {
      logger.warn(`Chief Engineer reported BLOCKED. See: ${blockedFile}`);
      this.sessionManager.setStatus(sessionId, 'BLOCKED');
      return 'BLOCKED';
    } else {
      logger.warn("Chief Engineer finished turn without emitting DONE.md or BLOCKED.md.");
      return 'BLOCKED';
    }
  }
}
