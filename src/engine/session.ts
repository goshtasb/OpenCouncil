import * as fs from 'fs';
import * as path from 'path';
import { AgentOfficeStatus, ArchitectRuling, CouncilSessionMeta, SessionStatus } from '../types.js';
import { projectStateDir } from '../utils/paths.js';

export type OfficeSeat = 'lead_pm' | 'chief_engineer' | 'chief_architect';

export interface SessionStatusRecord {
  status: SessionStatus;
  updatedAt?: string;
  details: Record<string, any>;
}

export class SessionManager {
  readonly sessionsDir: string;

  constructor(customBaseDir?: string) {
    this.sessionsDir = customBaseDir || path.join(projectStateDir(), 'sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  getSessionPath(sessionId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(sessionId) || sessionId.startsWith('.')) {
      throw new Error(`Invalid session id '${sessionId}'.`);
    }
    return path.join(this.sessionsDir, sessionId);
  }

  sessionExists(sessionId: string): boolean {
    return fs.existsSync(path.join(this.getSessionPath(sessionId), 'meta.json'));
  }

  listSessions(): string[] {
    return fs.readdirSync(this.sessionsDir).filter(d => fs.existsSync(path.join(this.sessionsDir, d, 'meta.json'))).sort();
  }

  createSession(meta: CouncilSessionMeta): string {
    const sessionDir = this.getSessionPath(meta.id);
    if (fs.existsSync(path.join(sessionDir, 'meta.json'))) {
      throw new Error(`Session ${meta.id} already exists.`);
    }
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    this.logEvent(meta.id, `Created session ${meta.slug} on commit ${meta.baseSha}`);
    return sessionDir;
  }

  loadMeta(sessionId: string): CouncilSessionMeta {
    const metaFile = path.join(this.getSessionPath(sessionId), 'meta.json');
    if (!fs.existsSync(metaFile)) {
      throw new Error(`Session ${sessionId} does not exist in ${this.sessionsDir}`);
    }
    return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  }

  saveTask(sessionId: string, task: string): void {
    fs.writeFileSync(path.join(this.getSessionPath(sessionId), 'task.md'), task, 'utf8');
  }

  loadTask(sessionId: string): string | null {
    const file = path.join(this.getSessionPath(sessionId), 'task.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  /** Binding Chief Architect rulings on questions no standard or earlier ruling answered, shared with every seat. */
  loadArchitectRulings(sessionId: string): ArchitectRuling[] {
    const file = path.join(this.getSessionPath(sessionId), 'architect-rulings.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }

  appendArchitectRulings(sessionId: string, rulings: Omit<ArchitectRuling, 'id'>[]): ArchitectRuling[] {
    const all = this.loadArchitectRulings(sessionId);
    const added = rulings.map((r, i) => ({ id: all.length + i + 1, ...r }));
    fs.writeFileSync(path.join(this.getSessionPath(sessionId), 'architect-rulings.json'), JSON.stringify([...all, ...added], null, 2), 'utf8');
    return added;
  }

  logEvent(sessionId: string, message: string): void {
    const historyFile = path.join(this.getSessionPath(sessionId), 'HISTORY.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(historyFile, `[${timestamp}] ${message}\n`, 'utf8');
  }

  getStatus(sessionId: string): SessionStatusRecord {
    this.loadMeta(sessionId);
    const statusFile = path.join(this.getSessionPath(sessionId), 'STATUS.json');
    if (!fs.existsSync(statusFile)) {
      return { status: 'OPEN', details: {} };
    }
    const raw = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    const { status, updatedAt, details, ...legacyFlatDetails } = raw;
    return { status, updatedAt, details: { ...legacyFlatDetails, ...(details || {}) } };
  }

  /** Changes status; details are merged into the existing details so earlier facts (e.g. prdSha256) are kept. */
  setStatus(sessionId: string, status: SessionStatus, details: Record<string, any> = {}): void {
    const previous = this.sessionExists(sessionId) ? this.getStatus(sessionId).details : {};
    const statusFile = path.join(this.getSessionPath(sessionId), 'STATUS.json');
    const data: SessionStatusRecord = { status, updatedAt: new Date().toISOString(), details: { ...previous, ...details } };
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

  private activityFile(): string {
    return path.join(path.dirname(this.sessionsDir), 'activity.json');
  }

  setActivity(seat: OfficeSeat, state: AgentOfficeStatus['state'], detail: string): void {
    const all = this.getActivity();
    all[seat] = { state, detail };
    fs.writeFileSync(this.activityFile(), JSON.stringify(all, null, 2), 'utf8');
  }

  getActivity(): Partial<Record<OfficeSeat, AgentOfficeStatus>> {
    try {
      return JSON.parse(fs.readFileSync(this.activityFile(), 'utf8'));
    } catch {
      return {};
    }
  }
}

export function roundDirName(prefix: 'round' | 'tiebreak' | 'review' | 'signoff', round: number): string {
  return `${prefix}-${String(round).padStart(2, '0')}`;
}
