import { createApp } from './app.js';

const port = Number(process.env.PORT || 8080);
const app = createApp({
  templateDir: process.env.TEMPLATE_DIR || './templates',
  apiKey: process.env.API_KEY || '',
  pdf: {
    rhwpBin: process.env.RHWP_BIN || 'rhwp',
    fontPaths: (process.env.FONT_PATHS || '').split(':').filter(Boolean),
  },
});
app.listen(port, () => console.log(`hwpxpb server listening on :${port}`));
