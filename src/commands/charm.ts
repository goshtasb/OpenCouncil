import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import { CharmServer, loadOrCreateToken } from '../charm/server.js';
import { CharmBrains } from '../charm/brains.js';
import { BRAINS } from '../charm/router.js';
import { getAdapter } from '../adapters/registry.js';
import { projectStateDir } from '../utils/paths.js';
import { logger } from '../utils/logger.js';
import { CliContext, action } from './shared.js';

export function charmStateDir(repoRoot: string): string {
  return path.join(projectStateDir(repoRoot), 'charm');
}

export function registerCharmCommands(program: Command, ctx: CliContext): void {
  const charm = program
    .command('charm')
    .description('The Charm: a phone voice companion that talks to Claude, Gemini and Grok through this machine');

  charm
    .command('serve', { isDefault: true })
    .description('Start the charm bridge (loopback only; expose it to your phone with `tailscale serve`)')
    .option('-p, --port <number>', 'Port (default: charm.port from config)')
    .option('--host <host>', 'Interface to bind (default: charm.host, 127.0.0.1)')
    .action(action(async (options: { port?: string; host?: string }) => {
      const server = new CharmServer(ctx.config, { repoRoot: ctx.repoRoot, stateDir: charmStateDir(ctx.repoRoot) });
      const port = await server.start(options.port ? parseInt(options.port, 10) : ctx.config.charm.port, options.host || ctx.config.charm.host);
      const host = options.host || ctx.config.charm.host;
      logger.success(`Charm bridge listening on http://${host}:${port}`);
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
        logger.warn(`Bound to ${host}: anyone who can reach this address and has the token can talk to your council.`);
      }
      console.log(`\nOn this machine, once:   tailscale serve --bg ${port}`);
      console.log(`Then in the phone app:   https://${os.hostname().split('.')[0].toLowerCase()}.<your-tailnet>.ts.net`);
      console.log(`Token:                   council charm token`);
      console.log('\nPress Ctrl+C to stop.');
    }));

  charm
    .command('token')
    .description('Print the bearer token the phone app needs (or --rotate to replace it)')
    .option('--rotate', 'Generate a new token; the phone must be re-paired')
    .action(action((options: { rotate?: boolean }) => {
      console.log(loadOrCreateToken(charmStateDir(ctx.repoRoot), Boolean(options.rotate)));
    }));

  charm
    .command('route <text...>')
    .description('Show which brain would answer, without asking it (tune the rules with this)')
    .option('--no-llm', 'Skip the router model; rules and default only')
    .action(action(async (words: string[], options: { llm: boolean }) => {
      const config = options.llm ? ctx.config : { ...ctx.config, charm: { ...ctx.config.charm, routing: { ...ctx.config.charm.routing, llm_router: false } } };
      const route = await new CharmBrains(config).route(words.join(' '));
      console.log(JSON.stringify(route, null, 2));
    }));

  charm
    .command('ask <text...>')
    .description('Ask the charm from the terminal (routes exactly like the phone)')
    .option('-b, --brain <brain>', `Force one brain: ${BRAINS.join(', ')}`)
    .option('--panel', 'Ask all three; the judge answers')
    .action(action(async (words: string[], options: { brain?: string; panel?: boolean }) => {
      const brain = options.brain && (BRAINS as string[]).includes(options.brain) ? (options.brain as any) : undefined;
      if (options.brain && !brain) throw new Error(`--brain must be one of ${BRAINS.join(', ')}`);
      const result = await new CharmBrains(ctx.config).ask(words.join(' '), 'terminal', { brain, mode: options.panel ? 'panel' : undefined });
      if (result.route.mode === 'council') {
        console.log('That is council work — start it from the phone, or: council backlog add "..." && council open ... && council deliberate ...');
        return;
      }
      console.log(`[${result.route.mode} → ${result.speaker} via ${result.route.via}: ${result.route.reason}] ${(result.ms / 1000).toFixed(1)}s\n`);
      if (result.panel) {
        for (const b of BRAINS) {
          const r = result.panel[b];
          if (r) console.log(`${b.toUpperCase()} (${(r.ms / 1000).toFixed(1)}s): ${r.answer || `ERROR ${r.error}`}\n`);
        }
        console.log('— Final —');
      }
      console.log(result.answer);
    }));

  charm
    .command('doctor')
    .description('Ask each charm brain and the router for a live reply')
    .action(action(async () => {
      const brains = new CharmBrains(ctx.config);
      let failures = 0;
      const checks: Array<[string, { provider: string; model: string }]> = [
        ...BRAINS.map(b => [b, brains.brainConfig(b)] as [string, { provider: string; model: string }]),
        ['router', ctx.config.charm.routing.router]
      ];
      for (const [name, cfg] of checks) {
        const label = `${name} (${cfg.provider}${cfg.model ? `, ${cfg.model}` : ''})`;
        const t = Date.now();
        try {
          const adapter = getAdapter(cfg.provider);
          if (!(await adapter.isAvailable())) throw new Error(`'${cfg.provider}' CLI not found on PATH`);
          const reply = await adapter.runPrompt('Reply with the single word: PONG', { cwd: os.tmpdir(), model: cfg.model || undefined, timeoutSeconds: 120, permissionMode: name === 'claude' || name === 'router' ? undefined : 'plan' });
          if (!/pong/i.test(reply)) throw new Error(`unexpected reply: ${reply.trim().slice(0, 200)}`);
          logger.success(`${label}: OK in ${((Date.now() - t) / 1000).toFixed(1)}s`);
        } catch (err: any) {
          failures++;
          logger.error(`${label}: ${String(err.shortMessage || err.message).slice(0, 400)}`);
        }
      }
      if (failures > 0) process.exitCode = 1;
    }));
}
