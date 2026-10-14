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
import { FULL_SEATS, PROVIDER_CLIS, PROVIDER_FIXES, ProviderId, SOLO_SEATS, SeatsPlan, describePlan, detectProviders, planSeats, renderConfig } from '../setup.js';

export type DoctorFix = { kind: 'install' | 'login' | 'model' | 'unknown'; command: string | null };

/** The one command that fixes a failed seat check, from the provider and the error text. */
export function doctorFix(provider: string, err: { message?: string; stderr?: string; stdout?: string; notInstalled?: boolean }): DoctorFix {
  const fixes = PROVIDER_FIXES[provider as ProviderId];
  if (!fixes) return { kind: 'unknown', command: null };
  if (err.notInstalled) return { kind: 'install', command: fixes.install };
  const text = `${err.message || ''}\n${err.stderr || ''}\n${err.stdout || ''}`;
  if (/not logged in|log ?in|unauthori[sz]ed|authenticat|\b401\b|\b403\b|sign in|credential|api key|subscription|expired/i.test(text)) return { kind: 'login', command: fixes.login };
  if (/model|\b404\b|not found|unknown|invalid|unsupported|not available/i.test(text)) return { kind: 'model', command: fixes.models };
  return { kind: 'unknown', command: null };
}

export function registerProjectCommands(program: Command, ctx: CliContext): void {
  program
    .command('init')
    .description('Initialize .council/ in the current repository, choosing a provider for each seat from the CLIs installed')
    .option('--solo', 'Put every seat on Claude Code (Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet with no tools)')
    .option('--full', 'Write the default three-CLI config (Antigravity, Claude Code, Grok) without detecting what is installed')
    .option('--quick', 'Quick profile: at most 4 rounds, tie-break from round 3, six-point review, shorter documents')
    .option('--force', 'Rewrite an existing .council/config.yml; personas, contracts and standards are left as they are')
    .action(action(async (options: { solo?: boolean; full?: boolean; quick?: boolean; force?: boolean }) => {
      const targetDir = path.join(ctx.repoRoot, '.council');
      const configFile = path.join(targetDir, 'config.yml');
      const exists = fs.existsSync(targetDir);
      if (exists && !options.force) {
        logger.warn('.council configuration already exists. Re-run with --force to rewrite config.yml for the CLIs installed now.');
        return;
      }
      const templates = getTemplatesDir();
      let plan: SeatsPlan;
      let detected: string[] = [];
      if (options.solo) {
        plan = { mode: 'solo', seats: { ...SOLO_SEATS }, notes: ['Solo mode requested: every seat runs on Claude Code.'] };
      } else if (options.full) {
        plan = { mode: 'full', seats: { ...FULL_SEATS }, notes: ['Full three-CLI config requested: Antigravity, Claude Code and Grok.'] };
      } else {
        const found = await detectProviders();
        detected = Array.from(found).map(id => `${id} (${PROVIDER_CLIS[id]})`);
        plan = planSeats(found);
      }
      const config = renderConfig(fs.readFileSync(path.join(templates, '.council', 'config.yml'), 'utf8'), plan, { profile: options.quick ? 'quick' : 'full', detected });

      if (!exists) {
        copyDir(path.join(templates, '.council'), targetDir);
        copyDir(path.join(templates, 'personas'), path.join(targetDir, 'personas'));
        copyDir(path.join(templates, 'references'), path.join(targetDir, 'references'));
        copyDir(path.join(templates, 'standards'), path.join(targetDir, 'standards'));
      }
      fs.writeFileSync(configFile, config, 'utf8');

      logger.success(exists ? 'Rewrote .council/config.yml.' : 'Initialized .council/ with configuration, constitution, personas, contracts, and engineering standards.');
      logger.info(`Seats (${plan.mode} mode${options.quick ? ', quick profile' : ''}):`);
      for (const line of describePlan(plan)) console.log(`  ${line}`);
      for (const note of plan.notes) logger.info(note);
      if (plan.mode === 'none') logger.warn('Install at least Claude Code, then run `council init --force`.');
      logger.info(`Harness state (backlog, sessions, worktrees) is stored in ${projectStateDir(ctx.repoRoot)}`);
      logger.info('Next: council doctor');
    }));

  program
    .command('doctor')
    .description('Check that each configured seat CLI is installed and answers a trivial prompt; prints the command that fixes each failure')
    .option('--no-live', 'Only check that the CLIs are installed (no model calls)')
    .action(action(async (options: { live: boolean }) => {
      const failed: Array<{ seat: string; provider: string; fix: DoctorFix }> = [];
      let claudeInstalled = false;
      for (const [seat, seatConfig] of Object.entries(ctx.config.seats)) {
        const label = `${seat} (${seatConfig.provider}${seatConfig.model ? `, model ${seatConfig.model}` : ''})`;
        try {
          const adapter = getAdapter(seatConfig.provider);
          if (!(await adapter.isAvailable())) {
            const cli = PROVIDER_CLIS[seatConfig.provider as ProviderId] || seatConfig.provider;
            throw Object.assign(new Error(`'${cli}' CLI not found on PATH`), { notInstalled: true });
          }
          if (seatConfig.provider === 'claude-code') claudeInstalled = true;
          if (options.live) {
            const reply = await adapter.runPrompt('Reply with the single word: PONG', {
              cwd: ctx.repoRoot,
              model: seatConfig.model,
              timeoutSeconds: 180
            });
            if (!/pong/i.test(reply)) throw new Error(`unexpected reply: ${reply.trim().slice(0, 200)}`);
          }
          logger.success(`${label}: OK`);
          if (seat === 'chief_architect' && adapter.canDisableTools === false) {
            logger.warn(`${label}: this provider cannot be run without tools, so the Chief Architect would have repository access. The arbiter is meant to rule only on the text it is given — prefer claude-code, grok-cli or ollama for this seat.`);
          }
          if (seatConfig.provider === 'ollama') {
            logger.warn(`${label}: the Ollama adapter is experimental and has not completed a live council (issue #2).`);
          }
        } catch (err: any) {
          const fix = doctorFix(seatConfig.provider, err);
          failed.push({ seat, provider: seatConfig.provider, fix });
          const detail = [err.shortMessage || err.message, err.stderr, err.stdout].filter(Boolean).join('\n').trim();
          logger.error(`${label}: ${detail.slice(0, 600)}`);
          if (fix.command) console.log(`    fix (${fix.kind}): ${fix.command}`);
          else console.log(`    fix: run the '${PROVIDER_CLIS[seatConfig.provider as ProviderId] || seatConfig.provider}' CLI by hand with the same model and read its error; then edit seats.${seat} in .council/config.yml`);
        }
      }
      if (failed.length === 0) {
        logger.success(options.live
          ? 'Every seat answers. Next: council backlog add "<task>" then council open <slug> --item 001'
          : 'Every seat CLI is installed (no live check). Run `council doctor` for a live reply from each seat.');
        return;
      }
      logger.warn(`${failed.length} seat(s) need attention; the fix for each is printed above.`);
      if (!claudeInstalled) {
        try {
          claudeInstalled = await getAdapter('claude-code').isAvailable();
        } catch {
          claudeInstalled = false;
        }
      }
      if (claudeInstalled && failed.every(f => f.provider !== 'claude-code')) {
        console.log('    shortcut: council init --solo --force   (every seat on Claude Code; no other CLI needed)');
      }
      process.exitCode = 1;
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
