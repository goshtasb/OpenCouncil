import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';

export class GeminiCliAdapter implements AgentAdapter {
  readonly name = 'gemini-cli';
  // Plan mode restricts edits, not reads; there is no flag that removes the tool surface.
  readonly canDisableTools = false;

  async isAvailable(): Promise<boolean> {
    try {
      await execa('gemini', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const args: string[] = ['--output-format', 'text'];
    if (options.permissionMode === 'auto') {
      args.push('--approval-mode', 'yolo');
    } else if (options.permissionMode === 'exec') {
      args.push('--approval-mode', 'auto_edit');
    } else {
      args.push('--approval-mode', 'plan');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.appendArgs) {
      args.push(...options.appendArgs);
    }
    // Headless mode: the prompt arrives on stdin and `-p` is appended to it.
    args.push('-p', 'Follow the instructions provided above.');

    const { stdout } = await execa('gemini', args, {
      cwd: options.cwd,
      input: withPreamble(prompt, options.systemPrompt),
      timeout: (options.timeoutSeconds || 900) * 1000
    });
    return requireOutput(this.name, stdout);
  }
}
