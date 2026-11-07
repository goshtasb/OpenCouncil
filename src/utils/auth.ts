// Which credential each provider CLI will use, read from the environment the seats inherit.
// Open Council never reads, stores or forwards a credential: each seat CLI signs in by itself.
// This only names the one it will pick, so nobody is billed somewhere they did not expect.

export type AuthKind = 'plan' | 'api-key' | 'cloud' | 'local';

export interface SeatAuth {
  kind: AuthKind;
  /** What the CLI will use, in a few words, e.g. "API key from ANTHROPIC_API_KEY". */
  label: string;
  /** Set when the choice may surprise someone, e.g. a key that overrides a plan login. */
  warning?: string;
}

type Env = Record<string, string | undefined>;
const set = (env: Env, name: string) => typeof env[name] === 'string' && env[name]!.trim() !== '';
/** A switch variable such as GOOGLE_GENAI_USE_VERTEXAI counts only when it is turned on, not merely present. */
const on = (env: Env, name: string) => /^(1|true|yes)$/i.test((env[name] ?? '').trim());

/** Follows each CLI's documented precedence; the first credential it would use wins. */
export function describeAuth(provider: string, env: Env = process.env): SeatAuth {
  switch (provider) {
    case 'claude-code': {
      if (set(env, 'CLAUDE_CODE_USE_BEDROCK')) return { kind: 'cloud', label: 'Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK)' };
      if (set(env, 'CLAUDE_CODE_USE_VERTEX')) return { kind: 'cloud', label: 'Google Vertex AI (CLAUDE_CODE_USE_VERTEX)' };
      if (set(env, 'CLAUDE_CODE_USE_FOUNDRY')) return { kind: 'cloud', label: 'Microsoft Foundry (CLAUDE_CODE_USE_FOUNDRY)' };
      if (set(env, 'ANTHROPIC_AUTH_TOKEN')) return { kind: 'api-key', label: 'gateway token from ANTHROPIC_AUTH_TOKEN' };
      if (set(env, 'ANTHROPIC_API_KEY')) {
        return {
          kind: 'api-key',
          label: 'API key from ANTHROPIC_API_KEY',
          warning: 'ANTHROPIC_API_KEY is set, so Claude Code bills that key, not your Claude plan. Unset it to run on your plan.'
        };
      }
      if (set(env, 'CLAUDE_CODE_OAUTH_TOKEN')) return { kind: 'plan', label: 'your Claude plan, through CLAUDE_CODE_OAUTH_TOKEN' };
      return { kind: 'plan', label: 'your Claude login (run `claude` once to sign in)' };
    }
    case 'grok-cli':
      if (set(env, 'XAI_API_KEY')) return { kind: 'api-key', label: 'API key from XAI_API_KEY' };
      return { kind: 'plan', label: 'your Grok login' };
    case 'gemini-cli':
      // gemini-cli uses Vertex only when GOOGLE_GENAI_USE_VERTEXAI is on; a service-account path alone may belong to another tool.
      if (on(env, 'GOOGLE_GENAI_USE_VERTEXAI')) return { kind: 'cloud', label: 'Google Vertex AI (GOOGLE_GENAI_USE_VERTEXAI)' };
      if (set(env, 'GEMINI_API_KEY')) return { kind: 'api-key', label: 'API key from GEMINI_API_KEY' };
      if (set(env, 'GOOGLE_API_KEY')) return { kind: 'api-key', label: 'API key from GOOGLE_API_KEY' };
      return { kind: 'plan', label: 'your Google login' };
    case 'antigravity':
      return { kind: 'plan', label: 'your Google login (Antigravity takes no API key)' };
    case 'ollama':
      return { kind: 'local', label: 'local models, no account' };
    default:
      return { kind: 'plan', label: 'the CLI\'s own login' };
  }
}

/** True when the environment carries a Gemini API key or Vertex credentials, which gemini-cli can use and Antigravity cannot. */
export function hasGeminiKey(env: Env = process.env): boolean {
  return set(env, 'GEMINI_API_KEY') || set(env, 'GOOGLE_API_KEY') || on(env, 'GOOGLE_GENAI_USE_VERTEXAI');
}

const PROVIDER_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code', 'grok-cli': 'Grok', antigravity: 'Antigravity', 'gemini-cli': 'gemini-cli', ollama: 'Ollama'
};

/** One line per provider in use: "Claude Code (3 seats): API key from ANTHROPIC_API_KEY", plus any warnings. */
export function describeSeatLogins(seats: Record<string, { provider: string }>, env: Env = process.env): { lines: string[]; warnings: string[] } {
  const counts = new Map<string, number>();
  for (const s of Object.values(seats)) counts.set(s.provider, (counts.get(s.provider) || 0) + 1);
  const lines: string[] = [];
  const warnings: string[] = [];
  for (const [provider, n] of counts) {
    const auth = describeAuth(provider, env);
    lines.push(`${PROVIDER_NAMES[provider] || provider} (${n} seat${n === 1 ? '' : 's'}): ${auth.label}`);
    if (auth.warning) warnings.push(auth.warning);
  }
  return { lines, warnings };
}
