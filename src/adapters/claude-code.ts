import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput } from './base.js';

const PERMISSION_MODES: Record<NonNullable<AgentRunOptions['permissionMode']>, string> = {
  plan: 'plan',
  exec: 'acceptEdits',
  auto: 'bypassPermissions'
};

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
    if (options.permissionMode) {
      args.push('--permission-mode', PERMISSION_MODES[options.permissionMode]);
    } else {
      // No-tool seat (e.g. the Chief Architect judges only the text it is given).
      args.push('--permission-mode', 'plan', '--tools', '');
    }
    if (options.permissionMode !== 'auto') {
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

    const { stdout } = await execa('claude', args, {
      cwd: options.cwd,
      input: prompt,
      timeout: (options.timeoutSeconds || 900) * 1000
    });
    return requireOutput(this.name, stdout);
  }
}
