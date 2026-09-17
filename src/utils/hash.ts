import * as crypto from 'crypto';
import * as fs from 'fs';

export function sha256String(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function sha256File(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
