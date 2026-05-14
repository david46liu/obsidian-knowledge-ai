import * as mammoth from 'mammoth';
import { DOMParser } from '@xmldom/xmldom';
import type { Extractor, ExtractionResult } from 'src/extraction/types';

// ---------------------------------------------------------------------------
// Minimal HTML → GFM markdown converter
// Handles the subset that mammoth.convertToHtml emits:
//   block: h1-h6, p, table/tr/td/th
//   inline: strong, b, em, i, br
// ---------------------------------------------------------------------------

function getTextContent(node: ChildNode): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return node.nodeValue ?? '';
  }
  let text = '';
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childTag = (child as Element).tagName?.toLowerCase();
    if (childTag === 'strong' || childTag === 'b') {
      text += `**${getTextContent(child)}**`;
    } else if (childTag === 'em' || childTag === 'i') {
      text += `_${getTextContent(child)}_`;
    } else if (childTag === 'br') {
      text += '\n';
    } else {
      text += getTextContent(child);
    }
  }
  return text;
}

function convertTableToMarkdown(tableNode: Element): string {
  const rows: string[][] = [];
  const trNodes = tableNode.getElementsByTagName('tr');
  for (let i = 0; i < trNodes.length; i++) {
    const tr = trNodes[i];
    const cells: string[] = [];
    const childNodes = tr.childNodes;
    for (let j = 0; j < childNodes.length; j++) {
      const cell = childNodes[j] as Element;
      const cellTag = cell.tagName?.toLowerCase();
      if (cellTag === 'td' || cellTag === 'th') {
        // Escape pipes (would break GFM table) and collapse newlines (cells must be single-line)
        cells.push(
          getTextContent(cell)
            .trim()
            .replace(/\|/g, '\\|')
            .replace(/[\r\n]+/g, ' '),
        );
      }
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const pad = (r: string[]) =>
    '| ' + Array.from({ length: colCount }, (_, i) => r[i] ?? '').join(' | ') + ' |';

  const header = pad(rows[0]);
  const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
  const body = rows.slice(1).map(pad);

  return [header, separator, ...body].join('\n');
}

function htmlToMarkdown(html: string): string {
  // Wrap in root so xmldom can parse multiple sibling top-level elements
  const wrapped = `<root>${html}</root>`;
  const doc = new DOMParser().parseFromString(wrapped, 'text/xml');
  const root = doc.documentElement;
  if (!root) return html;

  const parts: string[] = [];
  const children = root.childNodes;
  for (let i = 0; i < children.length; i++) {
    const node = children[i] as unknown as Element;
    const tag = node.tagName?.toLowerCase();
    if (!tag) continue; // skip bare text nodes between blocks

    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch) {
      const level = parseInt(headingMatch[1], 10);
      parts.push(`${'#'.repeat(level)} ${getTextContent(node).trim()}`);
    } else if (tag === 'p') {
      const text = getTextContent(node).trim();
      if (text) parts.push(text);
    } else if (tag === 'table') {
      const tableMarkdown = convertTableToMarkdown(node);
      if (tableMarkdown) parts.push(tableMarkdown);
    } else {
      const text = getTextContent(node).trim();
      if (text) parts.push(text);
    }
  }

  return parts.join('\n\n') + (parts.length > 0 ? '\n' : '');
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export const docxExtractor: Extractor = {
  extensions: ['docx'],
  version: 1,

  async extract(buffer: ArrayBuffer, _opts?: Record<string, unknown>): Promise<ExtractionResult> {
    // mammoth's package.json maps lib/unzip.js → browser/unzip.js when bundled
    // with mainFields:['browser',...] (our worker bundle). The two versions
    // accept different option shapes:
    //   • Node version (lib/unzip.js):     options.buffer (Buffer)
    //   • Browser version (browser/unzip.js): options.arrayBuffer (ArrayBuffer)
    // Pass BOTH fields so the same call works in vitest (Node) and in the
    // worker bundle (browser). Each version picks the field it understands and
    // ignores the other.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = { arrayBuffer: buffer };
    if (typeof Buffer !== 'undefined') {
      input.buffer = Buffer.from(buffer);
    }

    const result = await mammoth.convertToHtml(input);
    const markdown = htmlToMarkdown(result.value);
    return {
      markdown,
      locatorMap: [],
    };
  },
};
