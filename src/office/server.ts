import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AgentOfficeStatus, CouncilConfig, OfficeState } from '../types.js';
import { PipelineManager } from '../engine/pipeline.js';
import { SessionManager } from '../engine/session.js';
import { logger } from '../utils/logger.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

export class OfficeServer {
  private config: CouncilConfig;
  private pipelineManager: PipelineManager;
  private sessionManager: SessionManager;
  private server: http.Server | null = null;
  readonly publicDir = path.join(__dirname, 'public');

  constructor(config: CouncilConfig, pipelineManager?: PipelineManager, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
    this.pipelineManager = pipelineManager || new PipelineManager(path.join(path.dirname(this.sessionManager.sessionsDir), 'backlog'));
  }

  start(port: number = this.config.office.port, host: string = '127.0.0.1'): Promise<number> {
    this.server = http.createServer((req, res) => {
      try {
        this.handle(req, res);
      } catch (err: any) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal error');
        logger.error(`Office request failed: ${err.message}`);
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => {
        const address = this.server!.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        logger.success(`Open Councilmen Office Dashboard running at http://localhost:${actualPort}`);
        resolve(actualPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;

    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(this.getOfficeState()));
      return;
    }

    let relative: string;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const root = path.resolve(this.publicDir);
    let filePath = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(root, 'index.html');
    }

    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
  }

  getOfficeState(): OfficeState {
    const items = this.pipelineManager.listItems();
    const active = this.pipelineManager.getActiveItem();
    const activity = this.sessionManager.getActivity();
    const fallback = (state: AgentOfficeStatus | undefined, idleDetail: string): AgentOfficeStatus => state || { state: 'idle', detail: idleDetail };

    return {
      synapse: fallback(activity.lead_pm, 'Standing by'),
      claude: fallback(activity.chief_engineer, 'Ready'),
      grok: fallback(activity.chief_architect, 'Guarding standards'),
      ticker: {
        text: active ? `Active: ${active.title} [Status: ${active.status}]` : 'Open Councilmen idle. Add backlog item to begin.'
      },
      pipeline: {
        activeItem: active ? { id: active.id, title: active.title, status: active.status } : undefined,
        items: items.map(i => ({ id: i.id, title: i.title, status: i.status, priority: i.priority }))
      }
    };
  }
}
