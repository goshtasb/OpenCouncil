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
}

// For CLIs without a system-prompt flag, the persona and contract are sent as a prompt preamble.
export function withPreamble(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `${systemPrompt}\n\n---\n\n${prompt}`;
}

export function requireOutput(adapterName: string, stdout: string): string {
  if (!stdout || !stdout.trim()) {
    throw new Error(`${adapterName} returned an empty response.`);
  }
  return stdout;
}
