import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { CouncilConfig, OfficeState } from '../types.js';
import { PipelineManager } from '../engine/pipeline.js';
import { SessionManager } from '../engine/session.js';
import { logger } from '../utils/logger.js';

export class OfficeServer {
  private config: CouncilConfig;
  private pipelineManager: PipelineManager;
  private sessionManager: SessionManager;
  private server: http.Server | null = null;

  constructor(config: CouncilConfig, pipelineManager?: PipelineManager, sessionManager?: SessionManager) {
    this.config = config;
    this.pipelineManager = pipelineManager || new PipelineManager();
    this.sessionManager = sessionManager || new SessionManager();
  }

  start(port: number = 4321): Promise<number> {
    const publicDir = path.join(__dirname, 'public');

    this.server = http.createServer((req, res) => {
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(this.getOfficeState()));
        return;
      }

      let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url || 'index.html');
      if (!fs.existsSync(filePath)) {
        filePath = path.join(publicDir, 'index.html');
      }

      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/javascript';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });

    return new Promise((resolve) => {
      this.server!.listen(port, () => {
        logger.success(`Open Councilmen Office Dashboard running at http://localhost:${port}`);
        resolve(port);
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private getOfficeState(): OfficeState {
    const items = this.pipelineManager.listItems();
    const active = this.pipelineManager.getActiveItem();

    return {
      synapse: {
        state: active?.status === 'in-council' ? 'busy' : 'idle',
        detail: active?.status === 'in-council' ? `Deliberating: ${active.title}` : 'Standing by'
      },
      claude: {
        state: active?.status === 'in-execution' ? 'busy' : active?.status === 'in-council' ? 'busy' : 'idle',
        detail: active?.status === 'in-execution' ? `Executing: ${active.title}` : 'Ready'
      },
      grok: {
        state: 'idle',
        detail: 'Guarding standards'
      },
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
