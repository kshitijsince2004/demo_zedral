import type { ExportFormat, ReportExecutionResult } from '../types';
import { artifactPath, writeArtifact } from '../jobs/artifactStore';

/**
 * Renders HTML report to PDF via Puppeteer when available.
 * Falls back to HTML artifact if Puppeteer is not installed.
 */
export async function renderPdf(
  jobId: string,
  result: ReportExecutionResult,
): Promise<{ filePath: string; sha256: string; bytes: number }> {
  const html = result.html;
  if (!html) {
    throw new Error('PDF export requires html content on ReportExecutionResult');
  }

  const pdfPath = artifactPath(jobId, 'PDF' as ExportFormat);

  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
      });
      const meta = writeArtifact(pdfPath, Buffer.from(buffer));
      return { filePath: pdfPath, ...meta };
    } finally {
      await browser.close();
    }
  } catch {
    const htmlPath = pdfPath.replace(/\.pdf$/i, '.html');
    const meta = writeArtifact(htmlPath, Buffer.from(html, 'utf8'));
    return { filePath: htmlPath, sha256: meta.sha256, bytes: meta.bytes };
  }
}
