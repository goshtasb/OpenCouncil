import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { SessionManager } from '../engine/session.js';
import { loadSessionReplay } from '../replay/session-replay.js';
import { renderReplayHtml } from '../replay/html.js';
import { buildBeats, playBeats, wrap } from '../replay/play.js';
import { logger } from '../utils/logger.js';
import { CliContext, action } from './shared.js';

/** The recorded session that ships with the package for `council demo`. */
export function demoSessionDir(): string {
  for (const dir of [path.resolve(__dirname, '..', '..', 'demo'), path.resolve(__dirname, '..', 'demo')]) {
    const session = path.join(dir, 'slugify-empty-and-accents');
    if (fs.existsSync(path.join(session, 'meta.json'))) return session;
  }
  throw new Error('The recorded demo session is missing from this install. Reinstall open-council-cli.');
}

/** A session argument is either a session id from `council status` or a path to a session directory. */
function resolveSessionDir(arg: string): string {
  if (fs.existsSync(path.join(arg, 'meta.json'))) return path.resolve(arg);
  const sessions = new SessionManager();
  sessions.loadMeta(arg); // throws the standard "Session … does not exist" error
  return sessions.getSessionPath(arg);
}

const DEMO_NOTE = 'This run was recorded in solo mode (every seat on Claude Code, quick profile) against a small slugify library. ' +
  'It ran in a local copy with no GitHub sign-in, so the last step could not open a pull request.';

function writeHtml(file: string, html: string): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
}

export function registerReplayCommands(program: Command, _ctx: CliContext): void {
  program
    .command('demo')
    .description('Play back a real recorded council run in the terminal, in about a minute. No setup, no model calls')
    .option('--fast', 'Print it all at once instead of at reading pace')
    .option('--html [file]', 'Write the full replay of the recorded run as one HTML page instead (default: council-demo.html)')
    .action(action(async (options: { fast?: boolean; html?: string | boolean }) => {
      const replay = loadSessionReplay(demoSessionDir());
      if (options.html) {
        const file = typeof options.html === 'string' ? options.html : 'council-demo.html';
        writeHtml(file, renderReplayHtml(replay, { note: DEMO_NOTE }));
        logger.success(`Wrote ${file}. Open it in a browser, or share the file: it needs nothing else.`);
        return;
      }
      const live = !options.fast && !!process.stdout.isTTY;
      const width = Math.max(50, Math.min(process.stdout.columns || 100, 100));
      const say = (text: string, style: (s: string) => string = chalk.dim) => console.log(wrap(text, width, '').map(l => style(l)).join('\n'));
      const recorded = replay.events[0]?.at ? new Date(replay.events[0].at).toISOString().slice(0, 10) : 'earlier';
      say(`Open Council demo: a real council run recorded on ${recorded}, played back. No models are called.`, chalk.bold);
      say('Three seats argue over a PRD until all of them sign off. Then the Chief Engineer builds it and the harness checks it.');
      console.log('');
      await playBeats(buildBeats(replay), { delayMs: live ? 900 : 0, width });
      say(DEMO_NOTE);
      console.log('');
      console.log(`Every reply in full:    ${chalk.bold('council demo --html')}`);
      console.log(`Run a council yourself: ${chalk.bold('npm install -g open-council-cli')}, then ${chalk.bold('council init --solo')}`);
    }));

  program
    .command('replay <session>')
    .description('Write a session as one self-contained HTML page you can open or share (session id or session directory)')
    .option('-o, --out <file>', 'Where to write the page (default: <session id>.html)')
    .option('--play', 'Play the session back in the terminal instead, like council demo')
    .option('--fast', 'With --play, print it all at once')
    .action(action(async (session: string, options: { out?: string; play?: boolean; fast?: boolean }) => {
      const replay = loadSessionReplay(resolveSessionDir(session));
      if (options.play) {
        const live = !options.fast && !!process.stdout.isTTY;
        await playBeats(buildBeats(replay), { delayMs: live ? 900 : 0, width: process.stdout.columns || 100 });
        return;
      }
      const file = options.out || `${replay.id}.html`;
      writeHtml(file, renderReplayHtml(replay));
      logger.success(`Wrote ${file}. It has no scripts and loads nothing from the network, so it can be shared as is.`);
    }));
}
