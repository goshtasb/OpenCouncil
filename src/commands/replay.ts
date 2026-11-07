import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from '../engine/session.js';
import { loadSessionReplay } from '../replay/session-replay.js';
import { renderReplayHtml } from '../replay/html.js';
import { buildBeats, playBeats } from '../replay/play.js';
import { logger } from '../utils/logger.js';
import { CliContext, action } from './shared.js';

/** A session argument is either a session id from `council status` or a path to a session directory. */
function resolveSessionDir(arg: string): string {
  if (fs.existsSync(path.join(arg, 'meta.json'))) return path.resolve(arg);
  const sessions = new SessionManager();
  sessions.loadMeta(arg); // throws the standard "Session … does not exist" error
  return sessions.getSessionPath(arg);
}

export function registerReplayCommands(program: Command, _ctx: CliContext): void {
  program
    .command('replay <session>')
    .description('Write a session as one self-contained HTML page you can open or share (session id or session directory)')
    .option('-o, --out <file>', 'Where to write the page (default: <session id>.html)')
    .option('--play', 'Play the session back in the terminal instead: who objected to what, each verdict, the gates and the outcome')
    .option('--fast', 'With --play, print it all at once instead of at reading pace')
    .action(action(async (session: string, options: { out?: string; play?: boolean; fast?: boolean }) => {
      const replay = loadSessionReplay(resolveSessionDir(session));
      if (options.play) {
        const live = !options.fast && !!process.stdout.isTTY;
        await playBeats(buildBeats(replay), { delayMs: live ? 900 : 0, width: process.stdout.columns || 100 });
        return;
      }
      const file = options.out || `${replay.id}.html`;
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, renderReplayHtml(replay), 'utf8');
      logger.success(`Wrote ${file}. It has no scripts and loads nothing from the network, so it can be shared as is.`);
    }));
}
