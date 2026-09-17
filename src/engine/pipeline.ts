import * as fs from 'fs';
import * as path from 'path';
import { BacklogItem } from '../types.js';
import { projectStateDir } from '../utils/paths.js';

const ACTIVE_STATUSES: BacklogItem['status'][] = ['in-council', 'awaiting-approval', 'in-execution'];

export function syncBacklogItem(pipeline: PipelineManager, itemId: string | undefined, status: BacklogItem['status'], session?: string): void {
  if (!itemId) return;
  if (!pipeline.getItem(itemId)) return;
  pipeline.updateItemStatus(itemId, status, session);
}

export class PipelineManager {
  readonly backlogDir: string;

  constructor(customBacklogDir?: string) {
    this.backlogDir = customBacklogDir || path.join(projectStateDir(), 'backlog');
    if (!fs.existsSync(this.backlogDir)) {
      fs.mkdirSync(this.backlogDir, { recursive: true });
    }
  }

  addItem(title: string, priority: number = 5, body: string = '', kind: string = 'feature'): BacklogItem {
    title = title.replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('Backlog item title must not be empty.');
    const existing = this.listItems();
    const nextNum = existing.reduce((max, i) => Math.max(max, parseInt(i.id, 10) || 0), 0) + 1;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'item';
    const id = String(nextNum).padStart(3, '0');
    const fileName = `${id}-${slug}.md`;
    const filePath = path.join(this.backlogDir, fileName);

    const item: BacklogItem = {
      id,
      slug,
      title,
      priority,
      status: 'todo',
      kind,
      created: new Date().toISOString(),
      body
    };

    const header = [
      `title=${item.title}`,
      `status=${item.status}`,
      `priority=${item.priority}`,
      `kind=${item.kind}`,
      `created=${item.created}`,
      '---',
      body
    ].join('\n');

    fs.writeFileSync(filePath, header, 'utf8');
    return item;
  }

  listItems(): BacklogItem[] {
    if (!fs.existsSync(this.backlogDir)) return [];
    const files = fs.readdirSync(this.backlogDir).filter(f => /^\d{3}-.*\.md$/.test(f)).sort();
    return files.map(f => this.parseItemFile(path.join(this.backlogDir, f)));
  }

  getActiveItem(): BacklogItem | null {
    const items = this.listItems();
    return items.find(i => ACTIVE_STATUSES.includes(i.status)) || null;
  }

  /** Returns the item if it may enter council now: it must be `todo` and the WIP limit must have room. */
  assertCanEnterCouncil(id: string, wipLimit: number): BacklogItem {
    const item = this.getItem(id);
    if (!item) throw new Error(`Backlog item ${id} not found.`);
    if (item.status !== 'todo') throw new Error(`Backlog item ${item.id} is '${item.status}', not 'todo'.`);
    const active = this.listItems().filter(i => ACTIVE_STATUSES.includes(i.status));
    if (active.length >= wipLimit) {
      throw new Error(`WIP limit ${wipLimit} reached: item ${active[0].id} "${active[0].title}" is '${active[0].status}'.`);
    }
    return item;
  }

  getNextTodoItem(): BacklogItem | null {
    const todos = this.listItems().filter(i => i.status === 'todo');
    if (todos.length === 0) return null;
    return todos.sort((a, b) => a.priority - b.priority)[0];
  }

  getItem(id: string): BacklogItem | null {
    return this.listItems().find(i => i.id === id) || null;
  }

  updateItemStatus(id: string, status: BacklogItem['status'], session?: string): void {
    const item = this.getItem(id);
    if (!item) throw new Error(`Backlog item ${id} not found.`);
    session = session || item.session;

    const fileName = `${item.id}-${item.slug}.md`;
    const filePath = path.join(this.backlogDir, fileName);

    const header = [
      `title=${item.title}`,
      `status=${status}`,
      `priority=${item.priority}`,
      `kind=${item.kind}`,
      `created=${item.created}`,
      session ? `session=${session}` : '',
      '---',
      item.body
    ].filter(Boolean).join('\n');

    fs.writeFileSync(filePath, header, 'utf8');
  }

  private parseItemFile(filePath: string): BacklogItem {
    const content = fs.readFileSync(filePath, 'utf8');
    const [headerPart, ...bodyParts] = content.split('\n---\n');
    const body = bodyParts.join('\n---\n') || '';

    const lines = headerPart.split('\n');
    const fields: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx !== -1) {
        fields[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }

    const baseName = path.basename(filePath, '.md');
    const id = baseName.slice(0, 3);
    const slug = baseName.slice(4);

    return {
      id,
      slug,
      title: fields.title || slug,
      priority: parseInt(fields.priority || '5', 10),
      status: (fields.status || 'todo') as BacklogItem['status'],
      kind: fields.kind || 'feature',
      created: fields.created || new Date().toISOString(),
      session: fields.session,
      body
    };
  }
}
