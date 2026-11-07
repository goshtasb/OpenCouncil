/**
 * A small Markdown-to-HTML renderer for replay pages. It covers what seats write (headings, lists,
 * tables, fenced code, quotes, bold, italics, inline code, links) and nothing more.
 * Every character of input is HTML-escaped before any markup is added, so a reply cannot inject HTML.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(raw: string): string {
  // Pull inline code out first so its contents are never formatted.
  const codes: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url}" rel="noopener noreferrer">${label}</a>`);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[parseInt(i, 10)]);
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      const lang = fence[2] ? ` class="lang-${escapeHtml(fence[2])}"` : '';
      html.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // Seat replies sit under the page's own h2/h3, so their headings start at h4.
      const level = Math.min(6, heading[1].length + 3);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      html.push('<div class="table"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }

    if (listItem.test(line)) {
      // Nested lists by indentation: open a list when an item is deeper, close when shallower.
      const stack: { indent: number; tag: 'ul' | 'ol' }[] = [];
      let out = '';
      while (i < lines.length) {
        const m = listItem.exec(lines[i]);
        if (!m) {
          // A continuation line belongs to the last item; a blank line followed by a non-item ends the list.
          if (lines[i].trim() && /^\s+/.test(lines[i]) && stack.length) { out = out.replace(/<\/li>$/, ' ' + inline(lines[i].trim()) + '</li>'); i++; continue; }
          if (!lines[i].trim() && i + 1 < lines.length && listItem.test(lines[i + 1])) { i++; continue; }
          break;
        }
        const indent = m[1].length;
        const tag: 'ul' | 'ol' = /\d/.test(m[2]) ? 'ol' : 'ul';
        if (!stack.length || indent > stack[stack.length - 1].indent) {
          if (stack.length) out = out.replace(/<\/li>$/, '');
          stack.push({ indent, tag });
          out += `<${tag}>`;
        } else {
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
            out += `</${stack.pop()!.tag}></li>`;
          }
        }
        out += `<li>${inline(m[3])}</li>`;
        i++;
      }
      while (stack.length) {
        const top = stack.pop()!;
        out += `</${top.tag}>` + (stack.length ? '</li>' : '');
      }
      html.push(out);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !listItem.test(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(`{3,}|~{3,})/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(isTableRow(lines[i]) && isTableSeparator(lines[i + 1] || ''))) {
      para.push(lines[i++].trim());
    }
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}
