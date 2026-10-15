export interface AgentRunOptions {
  cwd: string;
  systemPrompt?: string;
  timeoutSeconds?: number;
  model?: string;
  /**
   * undefined — no tools (pure reasoning, e.g. the Chief Architect)
   * 'plan'    — read-only research of the working directory
   * 'exec'    — may edit files, other tools need approval
   * 'auto'    — fully autonomous (edits and shell commands); only used inside an isolated execution clone
   */
  permissionMode?: 'plan' | 'exec' | 'auto';
  appendArgs?: string[];
}

export interface AgentAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  runPrompt(prompt: string, options: AgentRunOptions): Promise<string>;
  /**
   * Whether the CLI can actually run with no tools at all. The Chief Architect must judge only the
   * text placed before it, so a provider that cannot be stripped of tools is unfit for that seat.
   * Verified per provider against the installed CLI, not assumed.
   */
  readonly canDisableTools?: boolean;
}

// For CLIs without a system-prompt flag, the persona and contract are sent as a prompt preamble.
export function withPreamble(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `${systemPrompt}\n\n---\n\n${prompt}`;
}

const TRANSIENT_FAILURE = /empty response|interrupted|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|rate.?limit|overloaded|temporarily|try again|\b(?:429|502|503|529)\b/i;

/** True for failures that a second identical call usually fixes: an empty reply, a dropped connection, a transient 5xx. */
export function isTransientFailure(err: any): boolean {
  if (!err || err.timedOut) return false;
  return TRANSIENT_FAILURE.test(`${err.message || ''}\n${err.shortMessage || ''}\n${err.stderr || ''}\n${err.stdout || ''}`);
}

/**
 * One retry on a transient failure. In past live councils the single most common way a session
 * died was a seat returning nothing once; the second call almost always answered. Timeouts are
 * not retried: a seat that needs 15 minutes will need them again.
 */
export function withTransientRetry(adapter: AgentAdapter, delayMs: number = Number(process.env.COUNCIL_RETRY_DELAY_MS ?? 5000)): AgentAdapter {
  return {
    name: adapter.name,
    canDisableTools: adapter.canDisableTools,
    isAvailable: () => adapter.isAvailable(),
    async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
      try {
        return await adapter.runPrompt(prompt, options);
      } catch (err: any) {
        if (!isTransientFailure(err)) throw err;
        console.log(`[HARNESS] ${adapter.name} failed transiently (${(err.shortMessage || err.message || '').split('\n')[0].slice(0, 120)}); retrying once in ${Math.round(delayMs / 1000)}s.`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return adapter.runPrompt(prompt, options);
      }
    }
  };
}

export function requireOutput(adapterName: string, stdout: string): string {
  if (!stdout || !stdout.trim()) {
    throw new Error(`${adapterName} returned an empty response.`);
  }
  return stdout;
}
