// Runs a seat through an Agent Client Protocol (ACP) server, such as `agy acp`, speaking the
// protocol directly over stdio (newline-delimited JSON-RPC 2.0). No daemon, no new dependency.
//
// Read-only seats ('plan', and the no-tool seat) get two guarantees on top of the agent's own mode:
//   1. The agent's mode option is set to plan (when it offers one).
//   2. Every session/request_permission the agent sends is answered by the permission policy, which
//      by default refuses everything. The client also advertises no filesystem and no terminal
//      capability, so the agent cannot borrow ours.
// What the agent does WITHOUT asking stays the agent's own business. For agy that was checked on a
// real, signed-in agy (Nov 2026): in plan mode it would not write a file that it wrote when allowed.
import { spawn, ChildProcess } from 'child_process';
import { AgentAdapter, AgentRunOptions, requireOutput, withPreamble } from './base.js';

export interface AcpAdapterOptions {
  name: string;
  command: string;
  args: string[];
  /** ACP mode values for each OpenCouncil permission mode. */
  modes?: { plan: string; exec: string; auto: string };
  env?: Record<string, string>;
  /**
   * Which config options to set once the session is open, given what the agent advertised. Replaces
   * the default (set the 'model' option to options.model). May throw, e.g. for a model not offered.
   */
  configFor?: (advertised: AcpConfigOption[], options: AgentRunOptions) => Array<{ configId: string; value: string }>;
  /**
   * Whether to allow one permission ask. The default refuses every ask for read-only seats, allows
   * every ask for 'auto', and allows edit, read and search asks for 'exec'.
   */
  permissionPolicy?: (ask: AcpPermissionAsk, options: AgentRunOptions) => boolean;
}

export interface AcpConfigOption { id: string; category?: string; values: string[] }
export interface AcpPermissionAsk { title: string; kind?: string; command?: string }

/** What the run saw, beyond the answer. */
export interface AcpRunReport {
  permissionAsks: Array<{ title: string; kind?: string; answer: string }>;
  modeSet?: string;
  modelSet?: string;
  /** Config options set once the session opened, as id -> value. */
  configSet: Record<string, string>;
  /** The config options the agent advertised, as id -> values. */
  advertised?: Record<string, string[]>;
  /** Slash commands the agent announced. */
  commands?: string[];
  /** Tool calls the agent reported. */
  toolCalls: Array<{ title: string; kind?: string; status?: string }>;
  /** Last part of the agent's stderr. */
  stderrTail?: string;
}

/** Thrown when the agent could not even open a session: missing command, no ACP support, no login. */
export class AcpStartError extends Error {
  constructor(message: string, readonly cause?: any) {
    super(message);
    this.name = 'AcpStartError';
  }
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };

export class AcpAdapter implements AgentAdapter {
  readonly name: string;
  // The agent keeps its own tools; a client cannot prove they are off.
  readonly canDisableTools = false;
  lastReport: AcpRunReport | undefined;

  constructor(private readonly opts: AcpAdapterOptions) {
    this.name = opts.name;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const child = spawn(this.opts.command, ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', code => resolve(code === 0));
    });
  }

  async runPrompt(prompt: string, options: AgentRunOptions): Promise<string> {
    const timeoutMs = (options.timeoutSeconds || 900) * 1000;
    const readOnly = options.permissionMode === 'plan' || options.permissionMode === undefined;
    const modes = this.opts.modes || { plan: 'plan', exec: 'accept-edits', auto: 'auto' };
    const wantedMode = readOnly ? modes.plan : options.permissionMode === 'exec' ? modes.exec : modes.auto;
    const report: AcpRunReport = { permissionAsks: [], toolCalls: [], configSet: {} };
    this.lastReport = report;

    const child = spawn(this.opts.command, this.opts.args, {
      cwd: options.cwd,
      env: { ...process.env, ...(this.opts.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const conn = new JsonRpcConnection(child);
    let answer = '';
    let stderrTail = '';
    child.stderr!.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-2000); report.stderrTail = stderrTail; });

    conn.onRequest = async (method, params) => {
      if (method === 'session/request_permission') {
        const tc = params?.toolCall || {};
        const raw = tc.rawInput?.command;
        const ask: AcpPermissionAsk = {
          title: tc.title || '(untitled)',
          kind: tc.kind,
          command: typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(' ') : undefined,
        };
        const allow = (this.opts.permissionPolicy || defaultPolicy)(ask, options);
        const pick = (kinds: string[]) => (params?.options || []).find((o: any) => kinds.includes(o.kind));
        const chosen = allow ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always']);
        report.permissionAsks.push({ title: ask.title, kind: ask.kind, answer: chosen?.kind || 'cancelled' });
        return chosen ? { outcome: { outcome: 'selected', optionId: chosen.optionId } } : { outcome: { outcome: 'cancelled' } };
      }
      // We advertise no fs or terminal capability, so anything else is refused.
      throw { code: -32601, message: `client does not support ${method}` };
    };
    conn.onNotification = (method, params) => {
      if (method !== 'session/update') return;
      const u = params?.update;
      if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') answer += u.content.text;
      else if (u?.sessionUpdate === 'available_commands_update') report.commands = (u.availableCommands || []).map((c: any) => c.name);
      else if (u?.sessionUpdate === 'tool_call') report.toolCalls.push({ title: u.title, kind: u.kind, status: u.status });
      else if (u?.sessionUpdate === 'tool_call_update' && u.status) {
        const last = report.toolCalls[report.toolCalls.length - 1];
        if (last) last.status = u.status;
      }
    };

    const timer = setTimeout(() => conn.fail(Object.assign(new Error(`${this.name} timed out after ${timeoutMs / 1000}s`), { timedOut: true })), timeoutMs);
    try {
      let session: any;
      try {
        await conn.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        });
        session = await conn.request('session/new', { cwd: options.cwd, mcpServers: [] });
      } catch (err: any) {
        if (err?.timedOut) throw err;
        const tail = stderrTail.trim().split('\n').slice(-3).join(' ').slice(0, 300);
        throw new AcpStartError(`${this.name} could not start an ACP session (${err?.message || err})${tail ? `: ${tail}` : ''}`, err);
      }
      const sessionId: string = session.sessionId;
      const advertised: any[] = session.configOptions || [];
      const values: Record<string, string[]> = Object.fromEntries(advertised.map(o => [o.id, (o.options || []).flatMap((e: any) => e.options ? e.options.map((x: any) => x.value) : [e.value])]));
      report.advertised = { ...values };
      if (session.modes?.availableModes) report.advertised['(session modes)'] = session.modes.availableModes.map((m: any) => m.id);
      const option = (id: string, category: string) => advertised.find(o => o.id === id) || advertised.find(o => o.category === category);

      const modeOption = option('mode', 'mode');
      if (modeOption && (modeOption.options || []).some((o: any) => o.value === wantedMode)) {
        await conn.request('session/set_config_option', { sessionId, configId: modeOption.id, value: wantedMode });
        report.modeSet = wantedMode;
      } else if (session.modes?.availableModes?.some((m: any) => m.id === wantedMode)) {
        await conn.request('session/set_mode', { sessionId, modeId: wantedMode });
        report.modeSet = wantedMode;
      } else if (readOnly) {
        // Without a plan mode, read-only rests on refusing every ask. Say so rather than pretend.
        console.log(`[HARNESS] ${this.name} offers no "${wantedMode}" mode; read-only rests on refusing its permission asks.`);
      }

      const modelOption = option('model', 'model');
      const toSet = this.opts.configFor
        ? this.opts.configFor(advertised.map(o => ({ id: o.id, category: o.category, values: values[o.id] || [] })), options)
        : options.model && modelOption ? [{ configId: modelOption.id, value: options.model }] : [];
      for (const { configId, value } of toSet) {
        await conn.request('session/set_config_option', { sessionId, configId, value });
        report.configSet[configId] = value;
        if (modelOption && configId === modelOption.id) report.modelSet = value;
      }

      const text = withPreamble(prompt, options.systemPrompt);
      const result = await conn.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
      if (result?.stopReason && !['end_turn', 'max_tokens'].includes(result.stopReason)) {
        throw new Error(`${this.name} stopped with "${result.stopReason}"`);
      }
      return requireOutput(this.name, answer);
    } catch (err: any) {
      if (err && typeof err === 'object' && !err.stderr) err.stderr = stderrTail;
      throw err;
    } finally {
      clearTimeout(timer);
      conn.close();
    }
  }
}

function defaultPolicy(ask: AcpPermissionAsk, options: AgentRunOptions): boolean {
  if (options.permissionMode === 'auto') return true;
  if (options.permissionMode === 'exec') return ask.kind === 'edit' || ask.kind === 'read' || ask.kind === 'search';
  return false;
}

/** Newline-delimited JSON-RPC 2.0 over a child's stdio, the ACP transport. */
class JsonRpcConnection {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private failed: any;
  onRequest: (method: string, params: any) => Promise<any> = async () => { throw { code: -32601, message: 'no handler' }; };
  onNotification: (method: string, params: any) => void = () => {};

  constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (d: string) => this.read(d));
    child.on('error', err => this.fail(err));
    child.on('exit', (code, signal) => {
      // A clean exit after we closed stdin is ours; anything else mid-request is the seat dying.
      if (this.pending.size) this.fail(new Error(`agent process exited mid-turn (code ${code ?? 'none'}${signal ? `, signal ${signal}` : ''})`));
    });
  }

  request(method: string, params: any): Promise<any> {
    if (this.failed) return Promise.reject(this.failed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  fail(err: any): void {
    if (this.failed) return;
    this.failed = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.close();
  }

  close(): void {
    try { this.child.stdin!.end(); } catch { /* already closed */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      const killer = setTimeout(() => { try { this.child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
      killer.unref();
      try { this.child.kill('SIGTERM'); } catch { /* gone */ }
    }
  }

  private write(msg: any): void {
    try { this.child.stdin!.write(JSON.stringify(msg) + '\n'); } catch (err) { this.fail(err); }
  }

  private read(data: string): void {
    this.buffer += data;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method === undefined) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        msg.error ? p.reject(Object.assign(new Error(msg.error.message || 'ACP error'), { code: msg.error.code })) : p.resolve(msg.result);
      } else if (msg.id !== undefined) {
        this.onRequest(msg.method, msg.params).then(
          result => this.write({ jsonrpc: '2.0', id: msg.id, result }),
          error => this.write({ jsonrpc: '2.0', id: msg.id, error: { code: error?.code ?? -32603, message: error?.message || String(error) } })
        );
      } else {
        this.onNotification(msg.method, msg.params);
      }
    }
  }
}
