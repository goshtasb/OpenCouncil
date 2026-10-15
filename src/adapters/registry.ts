import { AgentAdapter, withTransientRetry } from './base.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { GrokCliAdapter } from './grok-cli.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { AntigravityAdapter } from './antigravity.js';
import { OllamaAdapter } from './ollama.js';

const adapters = new Map<string, AgentAdapter>();

// Every adapter, built in or registered, gets one retry on a transient failure (see withTransientRetry).
export function registerAdapter(providerName: string, adapter: AgentAdapter): void {
  adapters.set(providerName, withTransientRetry(adapter));
}

registerAdapter('claude-code', new ClaudeCodeAdapter());
registerAdapter('grok-cli', new GrokCliAdapter());
registerAdapter('gemini-cli', new GeminiCliAdapter());
registerAdapter('antigravity', new AntigravityAdapter());
registerAdapter('ollama', new OllamaAdapter());

export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}

export function getAdapter(providerName: string): AgentAdapter {
  const adapter = adapters.get(providerName);
  if (!adapter) {
    throw new Error(`Unsupported provider '${providerName}'. Available: ${listAdapters().join(', ')}`);
  }
  return adapter;
}
