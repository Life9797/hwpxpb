// rhwp 명령행 도구(export-pdf)로 HWPX → PDF 변환. 브라우저가 필요 없다.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function hwpxToPdf(
  hwpx,
  {
    rhwpBin = process.env.RHWP_BIN || 'rhwp',
    fontPaths = [],
    // 문서 글꼴이 없을 때 쓸 글꼴. 기본은 rhwp 기본값(Noto CJK KR)
    fallbackSerif = process.env.PDF_FALLBACK_SERIF,
    fallbackSans = process.env.PDF_FALLBACK_SANS,
    fallbackMono = process.env.PDF_FALLBACK_MONO,
    timeoutMs = 120_000,
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'hwpxpb-'));
  try {
    const input = join(dir, 'doc.hwpx');
    const output = join(dir, 'doc.pdf');
    await writeFile(input, hwpx);
    const args = ['export-pdf', input, '-o', output];
    for (const p of fontPaths) args.push('--font-path', p);
    if (fallbackSerif) args.push('--fallback-serif', fallbackSerif);
    if (fallbackSans) args.push('--fallback-sans', fallbackSans);
    if (fallbackMono) args.push('--fallback-mono', fallbackMono);
    await run(rhwpBin, args, timeoutMs);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d).length > 8000 && (stderr = stderr.slice(-8000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`PDF 변환기 실행 실패 (${cmd}): ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`PDF 변환 실패 (exit ${code ?? signal}): ${stderr.trim()}`));
    });
  });
}
