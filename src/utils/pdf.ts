import * as fs from 'fs';
import PDFDocument from 'pdfkit';

export interface PdfMetadata {
  title: string;
  session: string;
  prdSha256: string;
  approvalToken: string;
  signedOffBy?: string[];
  generatedAt?: Date;
}

const MARGIN = 56;
const BODY_SIZE = 10;
const MONO = 'Courier';
const BODY = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITALIC = 'Helvetica-Oblique';

/** Strips inline Markdown that has no meaning once rendered as styled text. */
function plain(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

/**
 * Renders the deliverable as an approval document: a cover block with the hash and the typed
 * approval token, then the Markdown body. Deliberately small-scale — headings, lists, code blocks,
 * tables and paragraphs are what a Brief + PRD actually uses.
 */
export function renderMarkdownToPdf(markdown: string, outputPath: string, meta: PdfMetadata): Promise<string> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN + 14, left: MARGIN, right: MARGIN },
    info: { Title: meta.title, Subject: `Open Council session ${meta.session}`, Keywords: meta.prdSha256 }
  });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  const generatedAt = meta.generatedAt || new Date();
  doc.font(BOLD).fontSize(20).fillColor('#0f380f').text(meta.title, { align: 'left' });
  doc.moveDown(0.3);
  doc.font(BODY).fontSize(9).fillColor('#444');
  doc.text(`Session: ${meta.session}`);
  doc.text(`SHA-256: ${meta.prdSha256}`);
  if (meta.signedOffBy?.length) doc.text(`Signed off by: ${meta.signedOffBy.join(', ')}`);
  doc.text(`Generated: ${generatedAt.toISOString()}`);
  doc.moveDown(0.5);
  doc.font(BOLD).fontSize(10).fillColor('#0f380f')
    .text(`Operator approval: council approve ${meta.session} "${meta.approvalToken}"`);
  doc.font(BODY).fontSize(8).fillColor('#666')
    .text('No code is written until the Operator types this token. Every council seat signed off this exact document.');
  doc.moveDown(0.6);
  doc.strokeColor('#8bac0f').lineWidth(1).moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fillColor('#111');

  const lines = markdown.split('\n');
  let inCode = false;
  let codeBuffer: string[] = [];

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    const text = codeBuffer.join('\n');
    const height = doc.font(MONO).fontSize(8.5).heightOfString(text, { width: doc.page.width - MARGIN * 2 - 12 });
    if (doc.y + height + 16 > doc.page.height - MARGIN - 14) doc.addPage();
    const top = doc.y;
    doc.rect(MARGIN - 4, top - 4, doc.page.width - MARGIN * 2 + 8, height + 10).fill('#f2f4ec');
    doc.fillColor('#1b2a3a').font(MONO).fontSize(8.5).text(text, MARGIN + 2, top + 1, { width: doc.page.width - MARGIN * 2 - 12 });
    doc.moveDown(0.6);
    doc.fillColor('#111');
    codeBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line.trim())) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }
    if (!line.trim()) {
      doc.moveDown(0.45);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level === 1 ? 16 : level === 2 ? 13 : 11;
      doc.moveDown(level === 1 ? 0.7 : 0.5);
      if (level === 1 && doc.y > doc.page.height / 2) doc.addPage();
      doc.font(BOLD).fontSize(size).fillColor(level === 1 ? '#0f380f' : '#306230').text(plain(heading[2]));
      doc.moveDown(0.25);
      doc.font(BODY).fontSize(BODY_SIZE).fillColor('#111');
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const indent = Math.min(3, Math.floor((line.length - line.trimStart().length) / 2));
      const marker = line.trim().match(/^(\d+\.)/) ? line.trim().match(/^(\d+\.)/)![1] : '•';
      const text = line.trim().replace(/^([-*+]|\d+\.)\s+/, '');
      doc.font(BODY).fontSize(BODY_SIZE).fillColor('#111')
        .text(`${marker} ${plain(text)}`, MARGIN + 12 + indent * 12, doc.y, { width: doc.page.width - MARGIN * 2 - 12 - indent * 12 });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // separator row
      doc.font(MONO).fontSize(8.5).fillColor('#111')
        .text(plain(line.trim()), MARGIN, doc.y, { width: doc.page.width - MARGIN * 2 });
      continue;
    }
    if (/^\s*>/.test(line)) {
      doc.font(ITALIC).fontSize(BODY_SIZE).fillColor('#444')
        .text(plain(line.replace(/^\s*>\s?/, '')), MARGIN + 12, doc.y, { width: doc.page.width - MARGIN * 2 - 12 });
      doc.fillColor('#111');
      continue;
    }
    if (/^\s*(-{3,}|_{3,})\s*$/.test(line)) {
      doc.moveDown(0.3);
      doc.strokeColor('#ccd6b0').lineWidth(0.5).moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).stroke();
      doc.moveDown(0.5);
      continue;
    }
    doc.font(BODY).fontSize(BODY_SIZE).fillColor('#111')
      .text(plain(line), MARGIN, doc.y, { width: doc.page.width - MARGIN * 2, align: 'left' });
  }
  flushCode();

  // Page numbers and the hash on every page, so a printed copy stays attributable.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(BODY).fontSize(7.5).fillColor('#666').text(
      `${meta.title} — ${meta.prdSha256.slice(0, 12)} — page ${i - range.start + 1} of ${range.count}`,
      MARGIN, doc.page.height - MARGIN + 2, { width: doc.page.width - MARGIN * 2, align: 'center' }
    );
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}
