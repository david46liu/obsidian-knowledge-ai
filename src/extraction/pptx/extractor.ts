// src/extraction/pptx/extractor.ts
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import type { Extractor, ExtractionResult, LocatorMapEntry } from 'src/extraction/types';

export const pptxExtractor: Extractor = {
  extensions: ['pptx'],
  version: 1,

  async extract(buffer: ArrayBuffer, opts?: Record<string, unknown>): Promise<ExtractionResult> {
    const includeNotes = opts?.includeNotes === true;

    // unzipSync throws on corrupt/non-zip input
    const files = unzipSync(new Uint8Array(buffer));

    const slidePaths = Object.keys(files)
      .filter(p => /^ppt\/slides\/slide(\d+)\.xml$/.test(p))
      .sort((a, b) => slideNum(a) - slideNum(b));

    let md = '';
    const locatorMap: LocatorMapEntry[] = [];

    for (const slidePath of slidePaths) {
      const idx = slideNum(slidePath);
      const xml = new TextDecoder('utf-8').decode(files[slidePath]);
      const { title, body } = parseSlideXml(xml);

      const headerLine = `## Slide ${idx}${title ? `: ${title}` : ''}\n\n`;
      const bodyText = body.length ? body + '\n\n' : '\n';
      const slideStart = md.length;
      md += headerLine + bodyText;
      locatorMap.push({
        charStart: slideStart,
        charEnd: md.length,
        locator: { kind: 'slide', index: idx, ...(title ? { title } : {}) },
      });

      if (includeNotes) {
        // D10 v1 simplification: notesSlide assoc by filename digit (no _rels resolution)
        const notesPath = `ppt/notesSlides/notesSlide${idx}.xml`;
        const notesBytes = files[notesPath];
        if (notesBytes) {
          const notesXml = new TextDecoder('utf-8').decode(notesBytes);
          const notesText = parseNotesXml(notesXml);
          if (notesText.trim()) {
            const noteHeader = `## Slide ${idx} · 备注\n\n`;
            const noteStart = md.length;
            md += noteHeader + notesText + '\n\n';
            locatorMap.push({
              charStart: noteStart,
              charEnd: md.length,
              locator: { kind: 'slide', index: idx, ...(title ? { title } : {}), isNote: true },
            });
          }
        }
      }
    }

    return { markdown: md, locatorMap };
  },
};

function slideNum(p: string): number {
  const m = /slide(\d+)\.xml$/.exec(p);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSlideXml(xml: string): { title: string | undefined; body: string } {
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level === 'fatalError') throw new Error('pptx slide XML 解析失败: ' + msg);
    },
  }).parseFromString(xml, 'application/xml');

  if (!doc?.documentElement) throw new Error('pptx slide XML 解析失败');

  const shapes = Array.from(doc.getElementsByTagNameNS('*', 'sp'));
  let title: string | undefined;
  const bodyParts: string[] = [];

  for (const sp of shapes) {
    const phType = sp.getElementsByTagNameNS('*', 'ph')[0]?.getAttribute('type');
    const text = Array.from(sp.getElementsByTagNameNS('*', 't'))
      .map(t => t.textContent ?? '')
      .join(' ')
      .trim();
    if (!text) continue;
    if (!title && (phType === 'title' || phType === 'ctrTitle')) {
      title = text;
    } else {
      bodyParts.push(text);
    }
  }

  return { title, body: bodyParts.join('\n\n') };
}

function parseNotesXml(xml: string): string {
  try {
    const doc = new DOMParser({
      onError: (level: string) => {
        if (level === 'fatalError') throw new Error('notes XML fatal');
      },
    }).parseFromString(xml, 'application/xml');
    if (!doc?.documentElement) return '';
    return Array.from(doc.getElementsByTagNameNS('*', 't'))
      .map(t => t.textContent ?? '')
      .join(' ')
      .trim();
  } catch {
    return ''; // 备注 XML 损坏不阻断主流程
  }
}
