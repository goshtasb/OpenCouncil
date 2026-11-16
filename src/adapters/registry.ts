import { AgentAdapter, withTransientRetry } from './base.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { GrokCliAdapter } from './grok-cli.js';
import { GeminiCliAdapter } from './gemini-cli.js';
import { AntigravityAdapter } from './antigravity.js';
import { OllamaAdapter } from './ollama.js';
import { AcpAdapter } from './acp.js';
import { HappyAgentAdapter } from './happy-agent.js';

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

// SPIKE: experimental seat transports, off unless COUNCIL_EXPERIMENTAL_ADAPTERS=1. Nothing in the
// defaults or templates uses them. See docs/spikes/happy-agent.md.
//   happy-agent      a seat run by a Happy Agent daemon (github.com/slopus/happy-agent)
//   antigravity-acp  Gemini through `agy acp`, spoken to directly over ACP, no daemon
if (process.env.COUNCIL_EXPERIMENTAL_ADAPTERS === '1') {
  registerAdapter('happy-agent', new HappyAgentAdapter());
  registerAdapter('antigravity-acp', new AcpAdapter({ name: 'antigravity-acp', command: process.env.COUNCIL_AGY_COMMAND || 'agy', args: ['acp'] }));
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
