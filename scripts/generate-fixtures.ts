import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  Packer,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const FIXTURES_DIR = join(__dirname, '..', 'src', 'extraction', '__tests__', 'fixtures');

// ── docx ──────────────────────────────────────────────────────────────────────

async function genDocx(): Promise<void> {
  // simple.docx — H1 + paragraph
  const simple = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('简单文档')],
          }),
          new Paragraph({ children: [new TextRun('这是正文。')] }),
        ],
      },
    ],
  });
  // simpleBuf 双用:
  //   1) 完整写入 simple.docx
  //   2) 截前 100 字节生成 corrupt.docx(末尾 truncated zip,用于 T4 错误路径)
  const simpleBuf = await Packer.toBuffer(simple);
  writeFileSync(join(FIXTURES_DIR, 'simple.docx'), simpleBuf);

  // with-headings.docx — H1 / H2 / H3 + body
  const headings = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('一级')] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('二级')] }),
          new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun('三级')] }),
          new Paragraph({ children: [new TextRun('内容')] }),
        ],
      },
    ],
  });
  writeFileSync(join(FIXTURES_DIR, 'with-headings.docx'), await Packer.toBuffer(headings));

  // with-tables.docx — paragraph + 2×2 table
  const withTables = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun('表前')] }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun('A')] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun('B')] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun('1')] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun('2')] })] }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  writeFileSync(join(FIXTURES_DIR, 'with-tables.docx'), await Packer.toBuffer(withTables));

  // corrupt.docx — first 100 bytes of simple.docx
  writeFileSync(join(FIXTURES_DIR, 'corrupt.docx'), simpleBuf.subarray(0, 100));
}

// ── pptx ──────────────────────────────────────────────────────────────────────

async function genPptx(): Promise<void> {
  // 2-slides.pptx
  const p1 = new PptxGenJS();
  const s1 = p1.addSlide();
  s1.addText('开篇标题', { x: 1, y: 1, fontSize: 32 });
  s1.addText('开篇正文。', { x: 1, y: 2, fontSize: 18 });
  const s2 = p1.addSlide();
  // NOTE: 文本字符串与 T6 测试断言绑定 — 必须包含 '第二张' 子串
  s2.addText('第二张', { x: 1, y: 1, fontSize: 32 });
  s2.addText('第二张正文。', { x: 1, y: 2, fontSize: 18 });
  await p1.writeFile({ fileName: join(FIXTURES_DIR, '2-slides.pptx') });

  // with-notes.pptx
  const p2 = new PptxGenJS();
  const sn = p2.addSlide();
  sn.addText('演讲者备注演示', { x: 1, y: 1, fontSize: 32 });
  sn.addNotes('这是只对演讲者可见的备注内容。');
  await p2.writeFile({ fileName: join(FIXTURES_DIR, 'with-notes.pptx') });

  // unicode.pptx
  const p3 = new PptxGenJS();
  const su = p3.addSlide();
  su.addText('Unicode 测试 — 日本語 한국어 emoji 🚀', { x: 0.5, y: 1, fontSize: 28 });
  await p3.writeFile({ fileName: join(FIXTURES_DIR, 'unicode.pptx') });

  // corrupt.pptx — first 200 bytes of 2-slides.pptx (written to a buffer first)
  const p4 = new PptxGenJS();
  const sc = p4.addSlide();
  sc.addText('base', { x: 1, y: 1, fontSize: 20 });
  // pptxgenjs doesn't have a "write to buffer" in all versions;
  // use outputType 'nodebuffer' via the stream API
  const fullBuf = (await p4.write({ outputType: 'nodebuffer' })) as Buffer;
  writeFileSync(join(FIXTURES_DIR, 'corrupt.pptx'), fullBuf.subarray(0, 200));
}

// ── xlsx ──────────────────────────────────────────────────────────────────────

function genXlsx(): void {
  // single-sheet.xlsx
  const wb1 = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Name', 'Age'],
    ['Alice', 30],
    ['Bob', 25],
  ]);
  XLSX.utils.book_append_sheet(wb1, ws1, 'Sheet1');
  XLSX.writeFile(wb1, join(FIXTURES_DIR, 'single-sheet.xlsx'));

  // multi-sheet.xlsx
  const wb2 = XLSX.utils.book_new();
  const ws2a = XLSX.utils.aoa_to_sheet([['A1', 'B1']]);
  const ws2b = XLSX.utils.aoa_to_sheet([
    ['X', 'Y'],
    [1, 2],
  ]);
  XLSX.utils.book_append_sheet(wb2, ws2a, 'First');
  XLSX.utils.book_append_sheet(wb2, ws2b, 'Second');
  XLSX.writeFile(wb2, join(FIXTURES_DIR, 'multi-sheet.xlsx'));

  // with-hidden.xlsx
  const wb3 = XLSX.utils.book_new();
  const wsVis = XLSX.utils.aoa_to_sheet([['Visible data']]);
  const wsHid = XLSX.utils.aoa_to_sheet([['Hidden data']]);
  XLSX.utils.book_append_sheet(wb3, wsVis, 'Visible');
  XLSX.utils.book_append_sheet(wb3, wsHid, 'Hidden');
  wb3.Workbook = {
    Sheets: [
      { name: 'Visible', Hidden: 0 },
      { name: 'Hidden', Hidden: 1 },
    ],
  };
  XLSX.writeFile(wb3, join(FIXTURES_DIR, 'with-hidden.xlsx'));

  // large-1000-rows.xlsx
  const wb4 = XLSX.utils.book_new();
  const rows: (string | number)[][] = [['Index', 'Label']];
  for (let i = 1; i <= 1000; i++) {
    rows.push([i, `row-${i}`]);
  }
  const ws4 = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb4, ws4, 'Big');
  XLSX.writeFile(wb4, join(FIXTURES_DIR, 'large-1000-rows.xlsx'));

  // corrupt.xlsx — first 80 bytes of a valid xlsx
  const wb5 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb5, XLSX.utils.aoa_to_sheet([['x']]), 'S');
  const buf = XLSX.write(wb5, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  writeFileSync(join(FIXTURES_DIR, 'corrupt.xlsx'), buf.subarray(0, 80));
}

// ── pdf ───────────────────────────────────────────────────────────────────────

async function genPdf(): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page1 = pdfDoc.addPage([595, 842]);
  page1.drawText('Page one content. Testing PDF extraction.', {
    x: 50, y: 750, size: 14, font,
  });

  const page2 = pdfDoc.addPage([595, 842]);
  page2.drawText('Page two content. Second page body text.', {
    x: 50, y: 750, size: 14, font,
  });

  const pdfBytes = await pdfDoc.save();
  writeFileSync(join(FIXTURES_DIR, 'simple.pdf'), pdfBytes);
  writeFileSync(join(FIXTURES_DIR, 'corrupt.pdf'), Buffer.from(pdfBytes).subarray(0, 100));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  await genDocx();
  await genPptx();
  genXlsx();
  await genPdf();
  console.log('Done. Fixtures written to:', FIXTURES_DIR);
}

// vitest globalSetup entry point
export default async function (): Promise<void> {
  await main();
}

// direct-run guard (tsx scripts/generate-fixtures.ts)
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
