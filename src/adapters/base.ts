export interface AgentRunOptions {
  cwd: string;
  systemPrompt?: string;
  timeoutSeconds?: number;
  model?: string;
  permissionMode?: 'plan' | 'exec' | 'auto';
  appendArgs?: string[];
}

export interface AgentAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  runPrompt(prompt: string, options: AgentRunOptions): Promise<string>;
}
