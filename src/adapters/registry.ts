import { AgentAdapter } from './base.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { GrokCliAdapter } from './grok-cli.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { AntigravityAdapter } from './antigravity.js';
import { OllamaAdapter } from './ollama.js';

const adapters = new Map<string, AgentAdapter>();
adapters.set('claude-code', new ClaudeCodeAdapter());
adapters.set('grok-cli', new GrokCliAdapter());
adapters.set('gemini-cli', new GeminiCliAdapter());
adapters.set('antigravity', new AntigravityAdapter());
adapters.set('ollama', new OllamaAdapter());

export function registerAdapter(providerName: string, adapter: AgentAdapter): void {
  adapters.set(providerName, adapter);
}

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
