// SPIKE (spike/happy-agent-seat): runs a seat through a running Happy Agent daemon
// (github.com/slopus/happy-agent, MIT) over its HTTP API on the daemon's Unix socket.
//
// The seat's model is a Happy model ID, e.g. "antigravity/gemini-4-argon" or "anthropic/opus-5".
// The adapter finds the provider that offers it in GET /v0/config, opens a fresh agent per call
// (so no earlier turn is replayed into the seat), sends the prompt with the mapped permission
// mode, and waits for the run to end. A failed or aborted run becomes an error, so the council's
// seat failover sees it at once instead of waiting out a timeout.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';

const PERMISSION: Record<string, string> = { plan: 'read_only', exec: 'workspace_write', auto: 'full_access' };

export function happyAgentPaths(env: NodeJS.ProcessEnv = process.env): { socket: string; token: string } {
  const home = env.HAPPY_HOME_DIR || path.join(os.homedir(), '.happy');
  return {
    socket: env.HAPPY_AGENT_SOCKET || path.join(home, 'agent', 'server.sock'),
    token: env.HAPPY_AGENT_TOKEN_FILE || path.join(home, 'agent', 'token'),
  };
}

export class HappyAgentError extends Error {
  constructor(message: string, readonly kind: string, readonly stderr?: string) {
    super(message);
    this.name = 'HappyAgentError';
  }
}

export class HappyAgentAdapter implements AgentAdapter {
  readonly name = 'happy-agent';
  // Foreign harnesses keep their own tools; Happy cannot prove they are off.
  readonly canDisableTools = false;

  constructor(private readonly pollMs: number = Number(process.env.COUNCIL_HAPPY_POLL_MS ?? 1000)) {}

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.call('GET', '/v0/health');
      return health?.ready === true;
    } catch {
      return false;
    }
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    if (!options.model) throw new HappyAgentError('happy-agent seats need a model, such as "antigravity/gemini-4-argon".', 'model');
    const timeoutMs = (options.timeoutSeconds || 900) * 1000;
    const deadline = Date.now() + timeoutMs;
    const mode = await this.resolveMode(options.model, PERMISSION[options.permissionMode || 'plan'] || 'read_only');

    const { project } = await this.call('POST', '/v0/projects', { path: options.cwd });
    // A project's root workspace has the project's ID.
    const { agent } = await this.call('POST', '/v0/agents', { workspaceId: project.id, title: 'OpenCouncil seat' });
    const text = withPreamble(prompt, options.systemPrompt);
    const { message } = await this.call('POST', `/v0/agents/${agent.id}/send`, { text, mode });

    try {
      for (;;) {
        if (Date.now() > deadline) {
          await this.call('POST', `/v0/agents/${agent.id}/abort`, {}).catch(() => undefined);
          throw Object.assign(new HappyAgentError(`happy-agent seat timed out after ${timeoutMs / 1000}s`, 'timeout'), { timedOut: true });
        }
        await new Promise(r => setTimeout(r, this.pollMs));
        const page = await this.call('GET', `/v0/agents/${agent.id}/messages?limit=200`);
        const run = (page.runs || []).find((r: any) => r.id === message.id || (r.messages || []).some((m: any) => m.id === message.id));
        if (!run || run.status === 'running') continue;
        const messages: any[] = run.messages || [];
        if (run.status !== 'completed') {
          const failure = messages.map(m => m.failure || m.error).filter(Boolean).pop();
          const said = messages.filter(m => m.role === 'service').flatMap(m => m.content || []).map((b: any) => b.text).filter(Boolean).pop();
          throw new HappyAgentError(`happy-agent run ${run.status}: ${failure?.message || said || run.reason || 'no detail'}`, failure?.kind || run.reason || 'error', said);
        }
        // The answer is the text of the last agent message (earlier ones are tool-use turns).
        const agentMessages = messages.filter(m => m.role === 'agent');
        const last = agentMessages[agentMessages.length - 1];
        const answer = (last?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        return requireOutput(this.name, answer);
      }
    } finally {
      await this.call('POST', `/v0/agents/${agent.id}/archive`, {}).catch(() => undefined);
    }
  }

  /** The provider offering `modelId`, and that model's default effort, from the daemon's live catalog. */
  private async resolveMode(modelId: string, permissionMode: string) {
    const { config } = await this.call('GET', '/v0/config');
    const providers = Object.entries<any>(config.providers || {});
    const offered = providers.find(([, p]) => p.enabled && (p.models || []).some((m: any) => m.id === modelId && m.enabled));
    if (!offered) {
      const known = providers.flatMap(([, p]) => p.enabled ? (p.models || []).filter((m: any) => m.enabled).map((m: any) => m.id) : []);
      throw new HappyAgentError(`happy-agent offers no enabled model "${modelId}". Enabled: ${known.slice(0, 8).join(', ') || 'none'}.`, 'model');
    }
    const model = config.models?.[modelId] || {};
    return { providerId: offered[0], modelId, effort: model.defaultEffort || 'medium', serviceTier: null, permissionMode };
  }

  private call(method: string, route: string, body?: any): Promise<any> {
    const { socket, token } = happyAgentPaths();
    let bearer: string;
    try {
      bearer = fs.readFileSync(token, 'utf8').trim();
    } catch {
      return Promise.reject(new HappyAgentError(`happy-agent is not set up: no token at ${token}. Install Happy Agent and run \`happy-agent start\`.`, 'login'));
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({
        socketPath: socket, path: route, method,
        headers: { authorization: `Bearer ${bearer}`, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) },
        timeout: 30_000,
      }, res => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', d => { data += d; });
        res.on('end', () => {
          let parsed: any;
          try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
          if ((res.statusCode || 500) >= 400) {
            reject(new HappyAgentError(`happy-agent ${method} ${route.split('?')[0]} answered ${res.statusCode}: ${parsed?.error?.message || parsed?.message || data.slice(0, 200)}`, 'error'));
          } else resolve(parsed);
        });
      });
      req.on('timeout', () => req.destroy(new Error('happy-agent request timed out')));
      req.on('error', (err: any) => {
        const down = err.code === 'ECONNREFUSED' || err.code === 'ENOENT';
        reject(new HappyAgentError(down ? `happy-agent daemon is not running (${err.code} on ${socket}).` : `happy-agent request failed: ${err.message}`, down ? 'daemon-down' : 'error'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
