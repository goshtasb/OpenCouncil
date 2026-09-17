import execa from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentAdapter, AgentRunOptions, requireOutput } from './base.js';

export class GrokCliAdapter implements AgentAdapter {
  readonly name = 'grok-cli';
  // `--tools none --deny '*'` verified: reads are blocked. (`--tools ''` alone does NOT disable them.)
  readonly canDisableTools = true;

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
      '--output-format', 'plain'
    ];

    if (options.permissionMode === 'auto') {
      args.push('--always-approve');
    } else if (options.permissionMode === 'exec') {
      args.push('--permission-mode', 'acceptEdits');
    } else if (options.permissionMode === 'plan') {
      args.push('--permission-mode', 'plan', '--max-turns', '40');
    } else {
      // No-tool seat (e.g. the Chief Architect). `--tools ''` does not disable tools in grok 0.2.x;
      // an unknown allow-list plus a deny-all rule does.
      args.push('--tools', 'none', '--deny', '*', '--max-turns', '10');
    }

    if (options.model) {
      args.unshift('-m', options.model);
    }
    if (options.systemPrompt) {
      args.push('--system-prompt-override', options.systemPrompt);
    }
    if (options.appendArgs) {
      args.push(...options.appendArgs);
    }

    try {
      const subprocess = execa(bin, args, {
        cwd: options.cwd,
        timeout: (options.timeoutSeconds || 480) * 1000
      });
      const { stdout } = await subprocess;
      return requireOutput(this.name, stdout);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
