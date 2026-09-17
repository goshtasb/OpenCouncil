import execa from 'execa';
import { AgentAdapter, AgentRunOptions } from './base.js';

export class GeminiCliAdapter implements AgentAdapter {
  readonly name = 'gemini-cli';

  async isAvailable(): Promise<boolean> {
    try {
      await execa('gemini', ['--version']);
      return true;
    } catch {
      try {
        await execa('agy', ['--version']);
        return true;
      } catch {
        return false;
      }
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    let bin = 'gemini';
    try {
      await execa('gemini', ['--version']);
    } catch {
      bin = 'agy';
    }

    const args: string[] = ['-p', prompt, '--output-format', 'text'];
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    const subprocess = execa(bin, args, {
      cwd: options.cwd,
      timeout: (options.timeoutSeconds || 900) * 1000
    });

    const { stdout } = await subprocess;
    return stdout;
  }
}
