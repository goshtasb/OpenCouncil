import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput } from './base.js';

// Verified 2026-10-14 (claude 2.1.280): with `--tools ''` the model cannot read a canary file, but it may
// answer "I'll read the file now" and stop. Telling it up front that it has no tools removes that failure.
const NO_TOOLS_NOTE = 'You have no tools in this session: no file access, no shell, no web. Judge only the text in the prompt and answer in full; never say you will look something up.';

const PERMISSION_MODES: Record<NonNullable<AgentRunOptions['permissionMode']>, string> = {
  plan: 'plan',
  exec: 'acceptEdits',
  auto: 'bypassPermissions'
};

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  // `--tools ''` verified: the model reports it has no file access.
  readonly canDisableTools = true;

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
    const systemPrompt = options.permissionMode ? options.systemPrompt : [NO_TOOLS_NOTE, options.systemPrompt].filter(Boolean).join('\n\n');
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt);
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
