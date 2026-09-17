import { Command } from 'commander';
import { ExecutionEngine } from '../engine/execution.js';
import { CliContext, action } from './shared.js';

export function registerExecutionCommands(program: Command, ctx: CliContext): void {
  program
    .command('handoff <session>')
    .description('Clone the repository for execution of an approved session')
    .action(action(async (sessionId: string) => {
      const worktree = await new ExecutionEngine(ctx.config).handoff(sessionId);
      console.log(`Ready in execution checkout: ${worktree}`);
    }));

  program
    .command('run <session>')
    .description('Launch autonomous execution, verify lint/tests, push and open the pull request')
    .option('--skip-agent', 'Only re-run the harness verification and publishing (e.g. after a push failure)')
    .action(action(async (sessionId: string, options: { skipAgent?: boolean }) => {
      const outcome = await new ExecutionEngine(ctx.config).run(sessionId, { skipAgent: options.skipAgent });
      console.log(`Execution finished with outcome: ${outcome}`);
      if (outcome !== 'DONE') process.exitCode = 2;
    }));
}
