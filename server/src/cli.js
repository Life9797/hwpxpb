#!/usr/bin/env node
// Unix 배치·쉘에서 서버 없이 바로 쓰는 명령행 도구.
//
//   hwpxpb schema  <양식.hwpx>
//   hwpxpb extract <문서.hwpx> [--combo-sep :]
//   hwpxpb fill    <양식.hwpx> <값.json|-> -o <출력.hwpx> [--pdf <출력.pdf>] [--combo-sep :] [--strict]
//   hwpxpb pdf     <문서.hwpx> -o <출력.pdf>
import { readFile, writeFile } from 'node:fs/promises';
import { HwpxDocument } from 'hwpx-form-engine';
import { hwpxToPdf } from './pdf.js';

// PDF 에는 빈 칸 안내문을 찍지 않는다
const printable = (bytes) => Buffer.from(new HwpxDocument(bytes).hideGuides().toBytes());
const pdfOpts = () => ({
  rhwpBin: process.env.RHWP_BIN || 'rhwp',
  fontPaths: (process.env.FONT_PATHS || '').split(':').filter(Boolean),
});

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') opt.output = argv[++i];
    else if (a === '--pdf') opt.pdf = argv[++i];
    else if (a === '--combo-sep') opt.comboSep = argv[++i];
    else if (a === '--strict') opt.strict = true;
    else pos.push(a);
  }
  return { pos, opt };
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const usage = `사용법:
  hwpxpb schema  <양식.hwpx>
  hwpxpb extract <문서.hwpx> [--combo-sep :]
  hwpxpb fill    <양식.hwpx> <값.json|-> -o <출력.hwpx> [--pdf <출력.pdf>] [--combo-sep :] [--strict]
  hwpxpb pdf     <문서.hwpx> -o <출력.pdf>`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  const comboSep = opt.comboSep ?? ':';
  const print = (o) => {
    process.stdout.write(JSON.stringify(o, null, 1) + '\n');
    return 0;
  };

  if (cmd === 'schema' && pos[0]) {
    const doc = new HwpxDocument(await readFile(pos[0]));
    return print({ table: doc.dbTable, schema: doc.schema() });
  }
  if (cmd === 'extract' && pos[0]) return print(new HwpxDocument(await readFile(pos[0])).extract({ comboSep }));
  if (cmd === 'fill' && pos[0] && pos[1] && opt.output) {
    const values = JSON.parse(pos[1] === '-' ? await readStdin() : await readFile(pos[1], 'utf8'));
    const doc = new HwpxDocument(await readFile(pos[0]));
    const result = doc.fill(values, { comboSep });
    print(result);
    if (opt.strict && (result.unknown.length || result.rejected.length)) return 2;
    const hwpx = doc.toBytes();
    await writeFile(opt.output, hwpx);
    if (opt.pdf) await writeFile(opt.pdf, await hwpxToPdf(printable(hwpx), pdfOpts()));
    return 0;
  }
  if (cmd === 'pdf' && pos[0] && opt.output) {
    await writeFile(opt.output, await hwpxToPdf(printable(await readFile(pos[0])), pdfOpts()));
    return 0;
  }
  console.error(usage);
  return 1;
}

main().then(
  (code) => process.exit(code ?? 0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);
