import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput } from './base.js';

export class OllamaAdapter implements AgentAdapter {
  readonly name = 'ollama';
  // Plain model execution: no tool surface at all.
  readonly canDisableTools = true;

  async isAvailable(): Promise<boolean> {
    try {
      await execa('ollama', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const model = options.model || 'llama3';
    let combinedPrompt = prompt;
    if (options.systemPrompt) {
      combinedPrompt = `System: ${options.systemPrompt}\n\nUser: ${prompt}`;
    }

    const subprocess = execa('ollama', ['run', model], {
      cwd: options.cwd,
      input: combinedPrompt,
      timeout: (options.timeoutSeconds || 600) * 1000
    });

    const { stdout } = await subprocess;
    return requireOutput(this.name, stdout);
  }
}
