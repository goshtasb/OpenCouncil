import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';

/** The model `council init` writes for an Antigravity seat. `agy models` lists what the installed CLI offers. */
export const ANTIGRAVITY_DEFAULT_MODEL = 'gemini-4-argon-high';

/**
 * Model ids earlier releases wrote into config.yml that current `agy` builds no longer offer.
 * A seat still set to one of these is retried once on the default instead of failing the session.
 */
export const RETIRED_ANTIGRAVITY_MODELS = new Set(['gemini-3.1-pro-high']);

/** Thrown when `agy` rejects the configured model. The message names the model and the fix, not agy's raw dump. */
export class AntigravityModelError extends Error {
  constructor(readonly model: string, readonly available: string[]) {
    super(
      `Antigravity does not offer the model "${model}". Set that seat's model in .council/config.yml ` +
      `(seats.lead_pm.model by default) to one that \`agy models\` lists` +
      (available.length ? `, for example ${available.slice(0, 6).map(m => `"${m}"`).join(', ')}.` : '.')
    );
    this.name = 'AntigravityModelError';
  }
}

/**
 * When `agy` is given a model it does not offer, it ends its output with an "Available models:" line
 * and the models it offers, two-space indented, one per line (test/fixtures/agy-model-rejection.txt
 * is a real capture). Detection keys on that block alone, not on agy's wording before it, and only
 * when the block ends the output, so a seat's real answer that merely quotes the phrase (a review of
 * this very adapter, say) is not mistaken for a rejection. Returns the listed models, or null.
 */
export function parseUnavailableModel(output: string): string[] | null {
  const lines = output.replace(/\s+$/, '').split(/\r?\n/);
  let marker = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*Available models:\s*$/i.test(lines[i])) { marker = i; break; }
  }
  if (marker === -1) return null;
  const entries = lines.slice(marker + 1);
  if (!entries.length || !entries.every(line => /^\s+\S/.test(line))) return null;
  return entries.map(line => line.trim());
}

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
    const baseArgs = args;
    const argsFor = (model?: string) => [...baseArgs, ...(model ? ['--model', model] : []), ...(options.appendArgs || [])];
    const timeoutMs = (timeoutSeconds + 30) * 1000;

    let stdout: string;
    try {
      stdout = await runForModel(argsFor(options.model), options.cwd, timeoutMs, options.model);
    } catch (err) {
      if (!(err instanceof AntigravityModelError) || !options.model || !RETIRED_ANTIGRAVITY_MODELS.has(options.model)) throw err;
      console.log(`[HARNESS] antigravity no longer offers "${options.model}"; retrying on "${ANTIGRAVITY_DEFAULT_MODEL}". Set that model in .council/config.yml to skip this retry.`);
      stdout = await runForModel(argsFor(ANTIGRAVITY_DEFAULT_MODEL), options.cwd, timeoutMs, ANTIGRAVITY_DEFAULT_MODEL);
    }
    // agy exits 0 even when a denied tool call prevented any answer.
    if (/^\S+: no output produced/.test(stdout.trim())) {
      throw new Error(`antigravity produced no answer: ${stdout.trim()}`);
    }
    return requireOutput(this.name, stdout);
  }
}

/** Runs agy and turns a model rejection, whether agy exits 0 or not, into an AntigravityModelError. */
async function runForModel(args: string[], cwd: string, timeoutMs: number, model: string | undefined): Promise<string> {
  let stdout: string;
  try {
    stdout = await runWithRetry(args, cwd, timeoutMs);
  } catch (err: any) {
    const output = `${err.stderr || ''}\n${err.stdout || ''}`;
    // A timeout or an interruption is not a model rejection, even if a partial answer quotes the marker:
    // keep the original error so withTransientRetry can still see it.
    if (err.timedOut || /error: interrupted/.test(output)) throw err;
    const available = parseUnavailableModel(output);
    if (available) throw new AntigravityModelError(model || '(agy default)', available);
    throw err;
  }
  // agy's exit code on a rejection is not known, so a zero exit is checked the same way.
  const available = parseUnavailableModel(stdout);
  if (available) throw new AntigravityModelError(model || '(agy default)', available);
  return stdout;
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
      await new Promise(resolve => setTimeout(resolve, Number(process.env.COUNCIL_RETRY_DELAY_MS ?? 5000)));
    }
  }
}
