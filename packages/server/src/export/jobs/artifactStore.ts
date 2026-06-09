import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ExportFormat } from '../types';

export const EXPORT_ARTIFACT_DIR = path.join(process.cwd(), 'tmp', 'exports');

export function ensureExportDir(): void {
  if (!fs.existsSync(EXPORT_ARTIFACT_DIR)) {
    fs.mkdirSync(EXPORT_ARTIFACT_DIR, { recursive: true });
  }
}

export function formatExtension(format: ExportFormat): string {
  if (format === 'XLSX') return 'xlsx';
  if (format === 'PDF') return 'pdf';
  return 'csv';
}

export function artifactPath(jobId: string, format: ExportFormat): string {
  return path.join(EXPORT_ARTIFACT_DIR, `export_${jobId}.${formatExtension(format)}`);
}

export function writeArtifact(filePath: string, content: Buffer): { sha256: string; bytes: number } {
  ensureExportDir();
  fs.writeFileSync(filePath, content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return { sha256, bytes: content.length };
}
