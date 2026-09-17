import execa from 'execa';
import { AgentAdapter, AgentRunOptions } from './base.js';

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    try {
      await execa('claude', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const args: string[] = ['-p'];
    if (options.permissionMode === 'plan') {
      args.push('--permission-mode', 'plan');
      args.push('--strict-mcp-config');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }
    if (options.appendArgs) {
      args.push(...options.appendArgs);
    }

    const subprocess = execa('claude', args, {
      cwd: options.cwd,
      input: prompt,
      timeout: (options.timeoutSeconds || 900) * 1000
    });

    const { stdout } = await subprocess;
    return stdout;
  }
}
