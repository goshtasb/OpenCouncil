import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { CharmBrain, CouncilConfig } from '../types.js';
import { CouncilEngine } from '../engine/council.js';
import { DeliberationEngine } from '../engine/deliberation.js';
import { ExecutionEngine } from '../engine/execution.js';
import { PipelineManager } from '../engine/pipeline.js';
import { SessionManager } from '../engine/session.js';
import { OfficeServer } from '../office/server.js';
import { logger } from '../utils/logger.js';
import { CharmBrains, shortError } from './brains.js';
import { BRAINS } from './router.js';

const MAX_BODY = 64 * 1024;

export interface CharmServerOptions {
  repoRoot: string;
  /** Directory for the token and the route log (defaults to <project state>/charm). */
  stateDir: string;
  sessionManager?: SessionManager;
  pipelineManager?: PipelineManager;
  brains?: CharmBrains;
}

/** Long council work the server started; the phone polls these. */
interface CharmJob {
  sessionId: string;
  kind: 'deliberation' | 'execution';
  state: 'running' | 'finished' | 'failed';
  detail?: string;
}

/**
 * `council charm`: the bridge between the phone and the council.
 * Every route except /charm/health needs `Authorization: Bearer <token>`.
 * Binds to loopback; the phone reaches it through `tailscale serve` (HTTPS, tailnet-only).
 */
export class CharmServer {
  readonly brains: CharmBrains;
  private sessions: SessionManager;
  private pipeline: PipelineManager;
  private office: OfficeServer;
  private server: http.Server | null = null;
  private jobs = new Map<string, CharmJob>();
  private token: string;

  constructor(private config: CouncilConfig, private options: CharmServerOptions) {
    this.sessions = options.sessionManager || new SessionManager();
    this.pipeline = options.pipelineManager || new PipelineManager(path.join(path.dirname(this.sessions.sessionsDir), 'backlog'));
    this.office = new OfficeServer(config, this.pipeline, this.sessions);
    this.brains = options.brains || new CharmBrains(config);
    this.token = loadOrCreateToken(options.stateDir);
  }

  get authToken(): string {
    return this.token;
  }

  start(port: number = this.config.charm.port, host: string = this.config.charm.host): Promise<number> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(err => {
        if (!err.statusCode) logger.error(`Charm request failed: ${err.message}`);
        if (!res.headersSent) send(res, err.statusCode || 500, { error: err.statusCode ? err.message : 'Internal error' });
        else res.end();
      });
    });
    // Panels can take minutes; keep the socket open for them.
    this.server.requestTimeout = 0;
    this.server.headersTimeout = 30_000;
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => {
        const address = this.server!.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
      this.server = null;
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (p === '/charm/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, name: 'open-council-charm' });
    }
    if (!this.authorized(req)) {
      return send(res, 401, { error: 'Missing or wrong token.' });
    }

    if (p === '/charm/status' && req.method === 'GET') return send(res, 200, this.status());

    if (p === '/charm/route' && req.method === 'POST') {
      const body = await readJson(req);
      const text = requireText(body);
      return send(res, 200, await this.brains.route(text, pickForce(body)));
    }

    if (p === '/charm/ask' && req.method === 'POST') {
      const body = await readJson(req);
      const text = requireText(body);
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 64) : 'default';
      try {
        const result = await this.brains.ask(text, conversationId, pickForce(body));
        if (result.route.mode === 'council') {
          // Saying "convene the council" is the explicit go-ahead; nothing is written before the phone approves the PRD.
          const job = await this.convene(result.route.text, Number(body.priority) || 3);
          this.log({ text, route: result.route, sessionId: job.sessionId });
          return send(res, 202, { route: result.route, answer: `The council is convened on it. I'll tell you when there's a document to approve.`, speaker: 'grok', session: job });
        }
        this.log({ text, route: result.route, speaker: result.speaker, ms: result.ms });
        return send(res, 200, result);
      } catch (err: any) {
        this.log({ text, error: shortError(err) });
        return send(res, err.statusCode || 502, { error: shortError(err) });
      }
    }

    if (p === '/charm/forget' && req.method === 'POST') {
      const body = await readJson(req);
      this.brains.forget(typeof body.conversationId === 'string' ? body.conversationId : 'default');
      return send(res, 200, { ok: true });
    }

    if (p === '/charm/convene' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        return send(res, 202, await this.convene(requireText(body), Number(body.priority) || 3));
      } catch (err: any) {
        return send(res, err.statusCode || 409, { error: shortError(err) });
      }
    }

    if (p === '/charm/sessions' && req.method === 'GET') {
      const list = this.sessions.listSessions().slice(-20).reverse().map(id => ({ id, status: this.sessions.getStatus(id).status, job: this.jobs.get(id) }));
      return send(res, 200, { sessions: list });
    }

    const sessionMatch = p.match(/^\/charm\/sessions\/([A-Za-z0-9._-]+)(\/approve)?$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      if (!this.sessions.sessionExists(sessionId)) return send(res, 404, { error: 'No such session.' });
      if (!sessionMatch[2] && req.method === 'GET') return send(res, 200, this.sessionView(sessionId));
      if (sessionMatch[2] && req.method === 'POST') {
        const body = await readJson(req);
        try {
          new CouncilEngine(this.config, this.sessions, this.pipeline).approve(sessionId, String(body.token || ''));
        } catch (err: any) {
          return send(res, 409, { error: shortError(err) });
        }
        if (body.execute) this.execute(sessionId);
        return send(res, 200, { ok: true, executing: Boolean(body.execute), ...this.sessionView(sessionId) });
      }
    }

    send(res, 404, { error: 'Not found.' });
  }

  /** Backlog item → session → deliberation in the background. The WIP limit still applies. */
  async convene(task: string, priority = 3): Promise<CharmJob & { item: string }> {
    const title = task.replace(/\s+/g, ' ').trim().slice(0, 80);
    const item = this.pipeline.addItem(title, Math.min(9, Math.max(1, priority)), task, 'feature');
    const council = new CouncilEngine(this.config, this.sessions, this.pipeline);
    let sessionId: string;
    try {
      sessionId = await council.open(this.options.repoRoot, item.slug.replace(/^[^a-z0-9]+/, '') || 'charm-item', { backlogItem: item.id });
    } catch (err: any) {
      const e = new Error(`Queued as backlog item ${item.id}, but the council cannot start it now: ${shortError(err)}`) as Error & { statusCode?: number };
      e.statusCode = 409;
      throw e;
    }
    const job: CharmJob = { sessionId, kind: 'deliberation', state: 'running' };
    this.jobs.set(sessionId, job);
    new DeliberationEngine(this.config, this.sessions, this.pipeline).run(sessionId)
      .then(outcome => {
        job.state = 'finished';
        job.detail = outcome.outcome === 'AWAITING_APPROVAL' ? 'Ready for your approval.' : `Stalled: ${outcome.reason}`;
      })
      .catch(err => {
        job.state = 'failed';
        job.detail = shortError(err);
      });
    return { ...job, item: item.id };
  }

  private execute(sessionId: string): void {
    const job: CharmJob = { sessionId, kind: 'execution', state: 'running' };
    this.jobs.set(sessionId, job);
    const engine = new ExecutionEngine(this.config, this.sessions, this.pipeline);
    engine.handoff(sessionId)
      .then(() => engine.run(sessionId))
      .then(outcome => {
        job.state = 'finished';
        job.detail = `Execution ${outcome}.`;
      })
      .catch(err => {
        job.state = 'failed';
        job.detail = shortError(err);
      });
  }

  sessionView(sessionId: string): Record<string, any> {
    const status = this.sessions.getStatus(sessionId);
    const view: Record<string, any> = {
      id: sessionId,
      status: status.status,
      rounds: this.sessions.getRoundsDone(sessionId),
      job: this.jobs.get(sessionId)
    };
    if (status.status === 'AWAITING_APPROVAL') {
      const prd = new CouncilEngine(this.config, this.sessions, this.pipeline).deliverable(sessionId);
      view.approvalToken = prd.approvalToken;
      view.summary = executiveSummary(prd.content);
      view.prd = prd.content.slice(0, 200_000);
    }
    return view;
  }

  status(): Record<string, any> {
    const office = this.office.getOfficeState();
    const seatOf: Record<CharmBrain, keyof typeof office> = { claude: 'claude', gemini: 'synapse', grok: 'grok' };
    const faces: Record<string, any> = {};
    for (const brain of BRAINS) {
      const seat = office[seatOf[brain]] as { state: string; detail: string };
      const charmState = this.brains.states[brain];
      faces[brain] = charmState !== 'idle'
        ? { state: charmState, detail: charmState === 'thinking' ? 'Thinking about your question' : 'Something went wrong' }
        : { state: seat.state === 'idle' ? 'idle' : 'council', detail: seat.detail };
    }
    return { faces, ticker: office.ticker.text, jobs: [...this.jobs.values()] };
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = String(req.headers.authorization || '');
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
    const expected = Buffer.from(this.token);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  private log(entry: Record<string, any>): void {
    try {
      fs.mkdirSync(this.options.stateDir, { recursive: true });
      fs.appendFileSync(path.join(this.options.stateDir, 'routes.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    } catch {}
  }
}

export function loadOrCreateToken(stateDir: string, rotate = false): string {
  const file = path.join(stateDir, 'token');
  if (!rotate && fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

function executiveSummary(markdown: string): string {
  const m = markdown.match(/^#{1,3}\s*Executive Summary\s*$([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im);
  return (m ? m[1] : markdown).trim().slice(0, 2000);
}

function pickForce(body: any): { brain?: CharmBrain; mode?: 'solo' | 'panel' } {
  const out: { brain?: CharmBrain; mode?: 'solo' | 'panel' } = {};
  if (BRAINS.includes(body.brain)) out.brain = body.brain;
  if (body.mode === 'solo' || body.mode === 'panel') out.mode = body.mode;
  return out;
}

function requireText(body: any): string {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw Object.assign(new Error('Field "text" is required.'), { statusCode: 400 });
  return text.slice(0, 8000);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_BODY) {
        // Keep draining so the 413 can still be written back, but stop buffering.
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Body too large.'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(Object.assign(new Error('Body must be JSON.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
