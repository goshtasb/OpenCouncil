import { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getTemplatesDir } from '../config.js';
import { PipelineManager } from '../engine/pipeline.js';
import { SessionManager } from '../engine/session.js';
import { resolveGates, DEFAULT_GATE_TIMEOUT_SECONDS } from '../engine/gates.js';
import { OfficeServer } from '../office/server.js';
import { getAdapter } from '../adapters/registry.js';
import { projectStateDir } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { CliContext, action, copyDir } from './shared.js';

export function registerProjectCommands(program: Command, ctx: CliContext): void {
  program
    .command('init')
    .description('Initialize Open Councilmen templates in the current repository')
    .action(action(() => {
      const targetDir = path.join(ctx.repoRoot, '.councilmen');
      if (fs.existsSync(targetDir)) {
        logger.warn('.councilmen configuration already exists.');
        return;
      }
      const templates = getTemplatesDir();
      copyDir(path.join(templates, '.councilmen'), targetDir);
      copyDir(path.join(templates, 'personas'), path.join(targetDir, 'personas'));
      copyDir(path.join(templates, 'references'), path.join(targetDir, 'references'));
      copyDir(path.join(templates, 'standards'), path.join(targetDir, 'standards'));
      logger.success('Initialized .councilmen/ with configuration, constitution, personas, contracts, and engineering standards.');
      logger.info(`Harness state (backlog, sessions, worktrees) is stored in ${projectStateDir(ctx.repoRoot)}`);
    }));

  program
    .command('doctor')
    .description('Check that each configured seat CLI is installed and answers a trivial prompt')
    .option('--no-live', 'Only check that the CLIs are installed (no model calls)')
    .action(action(async (options: { live: boolean }) => {
      let failures = 0;
      for (const [seat, seatConfig] of Object.entries(ctx.config.seats)) {
        const label = `${seat} (${seatConfig.provider}${seatConfig.model ? `, model ${seatConfig.model}` : ''})`;
        try {
          const adapter = getAdapter(seatConfig.provider);
          if (!(await adapter.isAvailable())) throw new Error(`'${seatConfig.provider}' CLI not found on PATH`);
          if (options.live) {
            const reply = await adapter.runPrompt('Reply with the single word: PONG', {
              cwd: ctx.repoRoot,
              model: seatConfig.model,
              timeoutSeconds: 180
            });
            if (!/pong/i.test(reply)) throw new Error(`unexpected reply: ${reply.trim().slice(0, 200)}`);
          }
          logger.success(`${label}: OK`);
        } catch (err: any) {
          failures++;
          const detail = [err.shortMessage || err.message, err.stderr, err.stdout].filter(Boolean).join('\n').trim();
          logger.error(`${label}: ${detail.slice(0, 600)}`);
        }
      }
      if (failures > 0) process.exitCode = 1;
    }));

  const backlog = program.command('backlog').description('Manage the agile council backlog (WIP limit from config)');

  backlog
    .command('add <title>')
    .description('Add a new item to the backlog')
    .option('-p, --priority <number>', 'Priority (1 = highest, 9 = lowest)', '5')
    .option('-k, --kind <type>', 'Kind (feature, bug, refactor)', 'feature')
    .option('-b, --body <text>', 'Detailed description of the item')
    .action(action((title: string, options: { priority: string; kind: string; body?: string }) => {
      const priority = parseInt(options.priority, 10);
      if (!Number.isInteger(priority) || priority < 1 || priority > 9) throw new Error('Priority must be an integer from 1 to 9.');
      const item = new PipelineManager().addItem(title, priority, options.body || '', options.kind);
      logger.success(`Added item ${item.id}: "${item.title}" [Priority ${item.priority}]`);
    }));

  backlog
    .command('list')
    .description('List all backlog items')
    .action(action(() => {
      const items = new PipelineManager().listItems();
      if (items.length === 0) {
        console.log('Backlog is empty.');
        return;
      }
      console.log('\nID   STATUS             PRIORITY  TITLE');
      console.log('------------------------------------------------------------');
      for (const item of items) {
        console.log(`${item.id.padEnd(4)} ${item.status.padEnd(18)} ${`p${item.priority}`.padEnd(9)} ${item.title}${item.session ? `  (${item.session})` : ''}`);
      }
      console.log('');
    }));

  program
    .command('status [session]')
    .description('Show session status (or list sessions)')
    .action(action((sessionId?: string) => {
      const sessions = new SessionManager();
      if (!sessionId) {
        const ids = sessions.listSessions();
        if (ids.length === 0) console.log('No sessions.');
        for (const id of ids) console.log(`${id.padEnd(48)} ${sessions.getStatus(id).status}`);
        return;
      }
      const status = sessions.getStatus(sessionId);
      console.log(JSON.stringify({ session: sessionId, rounds: sessions.getRoundsDone(sessionId), ...status }, null, 2));
    }));

  program
    .command('gates')
    .description('preview verification gates')
    .action(action(() => {
      const gates = resolveGates(ctx.config);
      if (gates.length === 0) {
        console.log('No verification gates are configured. Nothing is verified before a pull request is opened.');
        return;
      }
      for (const gate of gates) {
        const timeoutSeconds = gate.timeout_seconds ?? DEFAULT_GATE_TIMEOUT_SECONDS;
        console.log([
          gate.name,
          gate.required !== false ? 'required' : 'advisory',
          `${timeoutSeconds}s`,
          gate.standard || 'project gate',
          gate.command
        ].join('  '));
      }
    }));

  program
    .command('office')
    .description('Launch the live retro pixel-art office web dashboard (localhost only)')
    .option('-p, --port <number>', 'Port to listen on (default: office.port from config)')
    .action(action(async (options: { port?: string }) => {
      const port = options.port ? parseInt(options.port, 10) : ctx.config.office.port;
      const actualPort = await new OfficeServer(ctx.config).start(port);
      if (ctx.config.office.auto_open) {
        const url = `http://localhost:${actualPort}`;
        const opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
        spawn(opener[0] as string, opener[1] as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
      }
      console.log('Press Ctrl+C to stop office server.');
    }));
}
