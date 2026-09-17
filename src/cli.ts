import { Command } from 'commander';
import { loadConfig } from './config.js';
import { resolveRepoRoot } from './utils/paths.js';
import { CliContext } from './commands/shared.js';
import { registerProjectCommands } from './commands/project.js';
import { registerCouncilCommands } from './commands/council.js';
import { registerExecutionCommands } from './commands/execution.js';

const repoRoot = resolveRepoRoot();
const context: CliContext = { repoRoot, config: loadConfig(repoRoot) };

const program = new Command();
program
  .name('councilmen')
  .description('Open Councilmen — Autonomous Multi-Agent Deliberation & Execution Council')
  .version('0.1.0');

registerProjectCommands(program, context);
registerCouncilCommands(program, context);
registerExecutionCommands(program, context);

program.parseAsync(process.argv);
