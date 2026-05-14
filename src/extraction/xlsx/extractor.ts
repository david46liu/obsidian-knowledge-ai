// src/extraction/xlsx/extractor.ts
import * as XLSX from 'xlsx';
import type { Extractor, ExtractionResult, LocatorMapEntry } from 'src/extraction/types';

export const xlsxExtractor: Extractor = {
  extensions: ['xlsx'],
  version: 1,

  async extract(buffer: ArrayBuffer): Promise<ExtractionResult> {
    const wb = XLSX.read(new Uint8Array(buffer), {
      type: 'array',
      cellFormula: false,
      cellStyles: false,
      cellHTML: false,
    });

    let md = '';
    const locatorMap: LocatorMapEntry[] = [];

    for (const name of wb.SheetNames) {
      if (isHidden(wb, name)) continue;
      const ws = wb.Sheets[name];
      if (!ws) continue;

      // Record sheetStart BEFORE the ## heading so chunks that include the
      // heading line (charStart == sheetStart) still resolve to this sheet.
      const sheetStart = md.length;
      const sheetHeader = `## ${name}\n\n`;
      md += sheetHeader;

      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, raw: false });
      if (rows.length === 0) {
        md += '_(空)_\n\n';
        continue;
      }

      const headerCells = (rows[0] as unknown[]).map(c =>
        String(c ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '),
      );
      const headerLine = `| ${headerCells.join(' | ')} |\n`;
      const sepLine    = `| ${headerCells.map(() => '---').join(' | ')} |\n`;

      md += headerLine + sepLine;
      locatorMap.push({
        charStart: sheetStart,
        charEnd: md.length,
        locator: { kind: 'sheet', name, rowRange: [1, 1] },
      });

      for (let r = 1; r < rows.length; r++) {
        const rowCells = (rows[r] as unknown[]).map(c =>
          String(c ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' '),
        );
        const rowLine = `| ${rowCells.join(' | ')} |\n`;
        const rowStart = md.length;
        md += rowLine;
        locatorMap.push({
          charStart: rowStart,
          charEnd: md.length,
          locator: { kind: 'sheet', name, rowRange: [r + 1, r + 1] },
        });
      }
      md += '\n';
    }

    return { markdown: md, locatorMap };
  },
};

function isHidden(wb: XLSX.WorkBook, name: string): boolean {
  const meta = wb.Workbook?.Sheets?.find((s) => s.name === name);
  return meta?.Hidden === 1 || meta?.Hidden === 2;
}
