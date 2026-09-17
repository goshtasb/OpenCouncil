import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';

// Google Antigravity CLI (`agy`), the successor client for Gemini subscriptions.
export class AntigravityAdapter implements AgentAdapter {
  readonly name = 'antigravity';
  // Verified otherwise: in plan mode without approvals `agy` still reads workspace files, so a seat
  // that must have zero tools (the Chief Architect) cannot be enforced on this provider.
  readonly canDisableTools = false;

  async isAvailable(): Promise<boolean> {
    try {
      await execa('agy', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const timeoutSeconds = options.timeoutSeconds || 900;
    // agy only accepts the prompt as an argument (not on stdin).
    // agy does not treat its cwd as the workspace (it searches other directories), so scope it explicitly.
    const workspaceNote = `Your workspace is exactly the directory ${options.cwd}. Only read files inside it, using absolute paths under it.`;
    const args: string[] = [
      '-p', withPreamble(`${workspaceNote}\n\n${prompt}`, options.systemPrompt),
      '--add-dir', options.cwd,
      '--output-format', 'text',
      '--print-timeout', `${timeoutSeconds}s`,
      // Prompts carry model-written text; never expand it as slash commands or skills.
      '--disable-slash-commands'
    ];
    if (options.permissionMode === 'auto') {
      args.push('--dangerously-skip-permissions');
    } else if (options.permissionMode === 'exec') {
      args.push('--mode', 'accept-edits');
    } else if (options.permissionMode === 'plan') {
      // Plan mode blocks edits; headless mode cannot prompt, so reads must be pre-approved.
      args.push('--mode', 'plan', '--dangerously-skip-permissions');
    } else {
      // No-tool seat: plan mode without approvals, so every tool call is denied.
      args.push('--mode', 'plan');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.appendArgs) {
      args.push(...options.appendArgs);
    }

    const stdout = await runWithRetry(args, options.cwd, (timeoutSeconds + 30) * 1000);
    // agy exits 0 even when a denied tool call prevented any answer.
    if (/^\S+: no output produced/.test(stdout.trim())) {
      throw new Error(`antigravity produced no answer: ${stdout.trim()}`);
    }
    return requireOutput(this.name, stdout);
  }
}

// agy intermittently exits with "error: interrupted" (observed 2 of 3 attempts on identical input); retry once.
async function runWithRetry(args: string[], cwd: string, timeoutMs: number): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await execa('agy', args, { cwd, timeout: timeoutMs });
      return stdout;
    } catch (err: any) {
      const transient = /error: interrupted/.test(`${err.stderr || ''}${err.stdout || ''}`) && !err.timedOut;
      if (!transient || attempt >= 2) throw err;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
