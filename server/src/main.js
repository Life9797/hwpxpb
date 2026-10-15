import { existsSync } from 'node:fs';
import { createApp } from './app.js';

// 웹 에디터 화면 (scripts/build-pb-web.sh 결과). 없으면 API 만 연다
const defaultWeb = new URL('../../pb/dist/', import.meta.url).pathname;
const webDir = process.env.WEB_DIR ?? (existsSync(defaultWeb) ? defaultWeb : '');

const port = Number(process.env.PORT || 8080);
const app = createApp({
  templateDir: process.env.TEMPLATE_DIR || './templates',
  webDir,
  apiKey: process.env.API_KEY || '',
  pdf: {
    rhwpBin: process.env.RHWP_BIN || 'rhwp',
    fontPaths: (process.env.FONT_PATHS || '').split(':').filter(Boolean),
  },
});
app.listen(port, () => console.log(`hwpxpb server listening on :${port}` + (webDir ? ' (web editor: /)' : '')));
