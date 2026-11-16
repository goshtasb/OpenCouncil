import execa from 'execa';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';
import { AcpAdapter, AcpConfigOption, AcpPermissionAsk, AcpStartError } from './acp.js';
import { isReadOnlyCommand } from './readonly-command.js';

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

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Maps a seat's model to the config options `agy acp` takes. The CLI names a model with its thinking
 * level ("gemini-4-argon-high", or the display name "Gemini 4 Argon (High)"); over ACP agy offers the
 * model ("gemini-4-argon") and the level ("thought_level": "high") as two options. Names are compared
 * ignoring case and punctuation, so "Claude Opus 5.5 (High)" finds "claude-opus-5-5". Throws an
 * AntigravityModelError, listing what agy offers, for a model it does not offer.
 */
export function acpModelConfig(requested: string | undefined, advertised: AcpConfigOption[]): Array<{ configId: string; value: string }> {
  if (!requested) return [];
  const modelOption = advertised.find(o => o.id === 'model') || advertised.find(o => o.category === 'model');
  if (!modelOption) {
    console.log(`[HARNESS] antigravity offers no model option over ACP; "${requested}" cannot be set, so agy's default model runs.`);
    return [];
  }
  const exact = modelOption.values.find(v => key(v) === key(requested));
  if (exact) return [{ configId: modelOption.id, value: exact }];
  const levelOption = advertised.find(o => o.id === 'thought_level') || advertised.find(o => o.category === 'thought_level');
  const m = /^(.*)-(low|medium|high)$/.exec(key(requested));
  const base = m && modelOption.values.find(v => key(v) === m[1]);
  if (m && base) {
    const level = levelOption?.values.find(v => key(v) === m[2]);
    return [{ configId: modelOption.id, value: base }, ...(levelOption && level ? [{ configId: levelOption.id, value: level }] : [])];
  }
  throw new AntigravityModelError(requested, modelOption.values);
}

/**
 * What a read-only seat may say yes to when agy asks: reading and searching, and shell commands that
 * only read (see isReadOnlyCommand). Edits, deletes, moves, mode switches, fetches and every other
 * command are refused. The no-tool seat is refused everything.
 */
export function readOnlyPolicy(ask: AcpPermissionAsk, options: AgentRunOptions): boolean {
  if (options.permissionMode !== 'plan') return false;
  if (ask.kind === 'read' || ask.kind === 'search' || ask.kind === 'think') return true;
  return ask.kind === 'execute' && isReadOnlyCommand(ask.command ?? ask.title);
}

/**
 * agy answers with its own notice, as if it were the reply, when the subscription's quota is used
 * up ("Individual quota reached. Please upgrade your subscription..."). That is not a seat's answer.
 * Only a short reply counts, so a review that quotes the notice is still a review.
 */
export function isQuotaNotice(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length < 400 && /quota (reached|exceeded|exhausted)|upgrade your subscription to increase your limits/i.test(t);
}

// Google Antigravity CLI (`agy`), the successor client for Gemini subscriptions.
//
// Read-only seats (plan, and the no-tool seat) run over `agy acp` (issue #46). On the CLI path agy
// ignores `--mode plan` whenever `--disable-slash-commands` is set (it says so on stderr), and plan
// seats also had `--dangerously-skip-permissions`, so a "read-only" seat could write: on a real agy
// it created a file it was told to create. Over ACP the seat runs in agy's plan mode and every write
// agy asks for is refused; the same prompt that wrote on the CLI path wrote nothing there, while the
// same prompt in agy's auto mode did write (so the prompt really asks for a write). Exec and auto
// seats keep the CLI path unchanged.
//
// Two side effects of agy's plan mode, both outside the workspace: it may save its plan as
// implementation_plan.md under ~/.gemini/antigravity-cli/brain, and it keeps its own session state there.
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
    const out = options.permissionMode === 'plan' || options.permissionMode === undefined
      ? await this.runReadOnly(prompt, options)
      : await this.runCli(prompt, options);
    if (isQuotaNotice(out)) throw new Error(`antigravity hit its usage limit: agy answered "${out.trim().slice(0, 200)}"`);
    return out;
  }

  private async runReadOnly(prompt: string, options: AgentRunOptions): Promise<string> {
    const workspaceNote = `Your workspace is exactly the directory ${options.cwd}. Only read files inside it, using absolute paths under it.`;
    const runOn = (model: string | undefined) => new AcpAdapter({
      name: this.name,
      command: 'agy',
      args: ['acp'],
      configFor: advertised => acpModelConfig(model, advertised),
      permissionPolicy: readOnlyPolicy,
    }).runPrompt(`${workspaceNote}\n\n${prompt}`, options);
    try {
      try {
        return await runOn(options.model);
      } catch (err) {
        if (!(err instanceof AntigravityModelError) || !options.model || !RETIRED_ANTIGRAVITY_MODELS.has(options.model)) throw err;
        console.log(`[HARNESS] antigravity no longer offers "${options.model}"; retrying on "${ANTIGRAVITY_DEFAULT_MODEL}". Set that model in .council/config.yml to skip this retry.`);
        return await runOn(ANTIGRAVITY_DEFAULT_MODEL);
      }
    } catch (err) {
      // Never fall back to the CLI path: there, plan mode is not enforced.
      if (err instanceof AcpStartError) {
        throw new Error(`antigravity: read-only seats run over \`agy acp\` (agy 1.5.5 or newer), and it did not start. ` +
          `Update agy, or check that \`agy\` is signed in. ${err.message}`);
      }
      throw err;
    }
  }

  private async runCli(prompt: string, options: AgentRunOptions): Promise<string> {
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
    // Only exec and auto seats come here; read-only seats run over ACP (runReadOnly).
    if (options.permissionMode === 'auto') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--mode', 'accept-edits');
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
