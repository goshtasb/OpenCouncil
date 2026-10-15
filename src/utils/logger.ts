import chalk from 'chalk';

// Commands whose stdout is a value (`SESSION=$(council open …)`) switch progress lines to stderr.
let out: (...args: unknown[]) => void = console.log;

export const logger = {
  /** Send info/success/warn/council lines to stderr, so stdout carries only the command's result. */
  useStderr: () => { out = console.error; },
  info: (msg: string) => out(chalk.cyan('ℹ'), chalk.white(msg)),
  success: (msg: string) => out(chalk.green('✔'), chalk.greenBright(msg)),
  warn: (msg: string) => out(chalk.yellow('⚠'), chalk.yellow(msg)),
  error: (msg: string) => console.error(chalk.red('✖'), chalk.redBright(msg)),
  council: (role: string, msg: string) => {
    const roleColors: Record<string, typeof chalk.Color> = {
      'LEAD PM': 'magenta',
      'CHIEF ENGINEER': 'blue',
      'CHIEF ARCHITECT': 'yellow',
      'OPERATOR': 'green',
      'HARNESS': 'cyan'
    };
    const color = roleColors[role] || 'white';
    out(chalk.bold[color](`[${role}]`), msg);
  }
};
