import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { ExportFormat } from '../types';

export const EXPORT_ARTIFACT_DIR = path.join(process.cwd(), 'tmp', 'exports');

/** Max age for leftover artifacts on startup sweep (24h). */
const STALE_MS = 24 * 60 * 60 * 1000;

export function ensureExportDir(): void {
  if (!fs.existsSync(EXPORT_ARTIFACT_DIR)) {
    fs.mkdirSync(EXPORT_ARTIFACT_DIR, { recursive: true, mode: 0o700 });
  } else {
    try {
      fs.chmodSync(EXPORT_ARTIFACT_DIR, 0o700);
    } catch {
      /* Windows / non-posix: best-effort */
    }
  }
}

/** Remove orphaned export_* files older than STALE_MS. Call once at worker/process start. */
export function sweepStaleArtifacts(now = Date.now()): number {
  ensureExportDir();
  let removed = 0;
  try {
    for (const name of fs.readdirSync(EXPORT_ARTIFACT_DIR)) {
      if (!name.startsWith('export_')) continue;
      const full = path.join(EXPORT_ARTIFACT_DIR, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > STALE_MS) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

export function unlinkArtifact(filePath: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best-effort */
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
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return { sha256, bytes: content.length };
}
