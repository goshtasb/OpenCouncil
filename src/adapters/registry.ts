import { AgentAdapter } from './base.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { GrokCliAdapter } from './grok-cli.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { OllamaAdapter } from './ollama.js';

const adapters = new Map<string, AgentAdapter>();
adapters.set('claude-code', new ClaudeCodeAdapter());
adapters.set('grok-cli', new GrokCliAdapter());
adapters.set('gemini-cli', new GeminiCliAdapter());
adapters.set('ollama', new OllamaAdapter());

export function getAdapter(providerName: string): AgentAdapter {
  const adapter = adapters.get(providerName);
  if (!adapter) {
    throw new Error(`Unsupported provider '${providerName}'. Available: ${Array.from(adapters.keys()).join(', ')}`);
  }
  return adapter;
}
