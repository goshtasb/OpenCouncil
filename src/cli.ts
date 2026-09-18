import { Command } from 'commander';
import { loadConfig } from './config.js';
import { CouncilConfig } from './types.js';
import { resolveRepoRoot } from './utils/paths.js';
import { CliContext } from './commands/shared.js';
import { registerProjectCommands } from './commands/project.js';
import { registerCouncilCommands } from './commands/council.js';
import { registerExecutionCommands } from './commands/execution.js';

const repoRoot = resolveRepoRoot();

// The configuration is read on first use — which is always inside a command's action()
// wrapper — so a malformed .council/config.yml surfaces as one clean error line
// instead of a load-time stack trace. Memoized: one load per process, one source of truth.
let loadedConfig: CouncilConfig | undefined;
const context: CliContext = {
  repoRoot,
  get config(): CouncilConfig {
    if (!loadedConfig) loadedConfig = loadConfig(repoRoot);
    return loadedConfig;
  }
};

const program = new Command();
program
  .name('council')
  .description('Open Council — Autonomous Multi-Agent Deliberation & Execution Council')
  .version('0.1.0');

registerProjectCommands(program, context);
registerCouncilCommands(program, context);
registerExecutionCommands(program, context);

program.parseAsync(process.argv);
