import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CouncilSessionMeta, SessionStatus } from '../types.js';
import { sha256String } from '../utils/hash.js';

export class SessionManager {
  readonly sessionsDir: string;

  constructor(customBaseDir?: string) {
    this.sessionsDir = customBaseDir || path.join(os.homedir(), '.councilmen', 'sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  sessionExists(sessionId: string): boolean {
    return fs.existsSync(path.join(this.getSessionPath(sessionId), 'meta.json'));
  }

  createSession(meta: CouncilSessionMeta): string {
    const sessionDir = this.getSessionPath(meta.id);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    this.logEvent(meta.id, `Created session ${meta.slug} on commit ${meta.baseSha}`);
    return sessionDir;
  }

  loadMeta(sessionId: string): CouncilSessionMeta {
    const metaFile = path.join(this.getSessionPath(sessionId), 'meta.json');
    if (!fs.existsSync(metaFile)) {
      throw new Error(`Session ${sessionId} does not exist`);
    }
    return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  }

  logEvent(sessionId: string, message: string): void {
    const historyFile = path.join(this.getSessionPath(sessionId), 'HISTORY.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(historyFile, `[${timestamp}] ${message}\n`, 'utf8');
  }

  getStatus(sessionId: string): { status: SessionStatus; details?: Record<string, any> } {
    const statusFile = path.join(this.getSessionPath(sessionId), 'STATUS.json');
    if (!fs.existsSync(statusFile)) {
      return { status: 'OPEN' };
    }
    try {
      return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch {
      return { status: 'OPEN' };
    }
  }

  setStatus(sessionId: string, status: SessionStatus, details: Record<string, any> = {}): void {
    const statusFile = path.join(this.getSessionPath(sessionId), 'STATUS.json');
    const data = { status, updatedAt: new Date().toISOString(), ...details };
    fs.writeFileSync(statusFile, JSON.stringify(data, null, 2), 'utf8');
    this.logEvent(sessionId, `Status changed to ${status}`);
  }

  getRoundsDone(sessionId: string): number {
    const sessionDir = this.getSessionPath(sessionId);
    const roundDirs = fs.readdirSync(sessionDir).filter(f => /^round-\d{2}$/.test(f));
    let completed = 0;
    for (const rd of roundDirs) {
      if (fs.existsSync(path.join(sessionDir, rd, 'verdict.json'))) {
        completed++;
      }
    }
    return completed;
  }
}
