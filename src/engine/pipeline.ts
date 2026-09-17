import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BacklogItem } from '../types.js';

export class PipelineManager {
  readonly backlogDir: string;

  constructor(customBacklogDir?: string) {
    this.backlogDir = customBacklogDir || path.join(os.homedir(), '.councilmen', 'backlog');
    if (!fs.existsSync(this.backlogDir)) {
      fs.mkdirSync(this.backlogDir, { recursive: true });
    }
  }

  addItem(title: string, priority: number = 5, body: string = '', kind: string = 'feature'): BacklogItem {
    const existing = this.listItems();
    const nextNum = existing.length + 1;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
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
    return items.find(i => ['in-council', 'awaiting-approval', 'in-execution', 'needs-decision'].includes(i.status)) || null;
  }

  getNextTodoItem(): BacklogItem | null {
    const todos = this.listItems().filter(i => i.status === 'todo');
    if (todos.length === 0) return null;
    return todos.sort((a, b) => a.priority - b.priority)[0];
  }

  updateItemStatus(id: string, status: BacklogItem['status'], session?: string): void {
    const item = this.listItems().find(i => i.id === id);
    if (!item) throw new Error(`Backlog item ${id} not found.`);

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
