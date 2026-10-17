// Python 엔진과 결과 비교용: 브라우저 엔진(engine/src/index.js)으로 같은 일을 하고 JSON 으로 출력
//   node parity.mjs <문서.hwpx> '<값 JSON>' [comboSep]
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { HwpxDocument } from '../../engine/src/index.js';

const [file, valuesJson = '{}', comboSep = ':'] = process.argv.slice(2);
const src = readFileSync(file);
const sections = (bytes) => {
  const e = unzipSync(bytes);
  return Object.fromEntries(Object.keys(e).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).map((n) => [n, strFromU8(e[n])]));
};
const doc = new HwpxDocument(src);
const out = { schema: doc.schema(), extract: doc.extract({ comboSep }) };
out.fill = doc.fill(JSON.parse(valuesJson), { comboSep });
out.filled = sections(doc.toBytes());
out.filledExtract = new HwpxDocument(doc.toBytes()).extract({ comboSep });
out.hidden = sections(new HwpxDocument(doc.toBytes()).hideGuides().toBytes());
process.stdout.write(JSON.stringify(out));
