import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(chalk.cyan('ℹ'), chalk.white(msg)),
  success: (msg: string) => console.log(chalk.green('✔'), chalk.greenBright(msg)),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), chalk.yellow(msg)),
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
    console.log(chalk.bold[color](`[${role}]`), msg);
  }
};
