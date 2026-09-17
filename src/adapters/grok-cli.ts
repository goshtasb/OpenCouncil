import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentAdapter, AgentRunOptions } from './base.js';

export class GrokCliAdapter implements AgentAdapter {
  readonly name = 'grok-cli';

  private findBinary(): string {
    const custom = process.env.GROK_BIN;
    if (custom && fs.existsSync(custom)) return custom;
    const homeGrok = path.join(os.homedir(), '.grok', 'bin', 'grok');
    if (fs.existsSync(homeGrok)) return homeGrok;
    return 'grok';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const bin = this.findBinary();
      await execa(bin, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const bin = this.findBinary();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencouncilmen-grok-'));
    const promptFile = path.join(tempDir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt, 'utf8');

    const args: string[] = [
      '--prompt-file', promptFile,
      '--disable-web-search',
      '--no-subagents',
      '--no-memory',
      '--tools', '',
      '--max-turns', '10',
      '--output-format', 'plain'
    ];

    if (options.model) {
      args.unshift('-m', options.model);
    }
    if (options.systemPrompt) {
      args.push('--system-prompt-override', options.systemPrompt);
    }

    try {
      const subprocess = execa(bin, args, {
        cwd: options.cwd,
        timeout: (options.timeoutSeconds || 480) * 1000
      });
      const { stdout } = await subprocess;
      return stdout;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
