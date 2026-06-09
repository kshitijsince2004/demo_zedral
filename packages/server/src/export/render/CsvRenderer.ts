import fs from 'fs';
import crypto from 'crypto';
import { escapeCsvCell } from '../../utils/csvWriter';
import type { ExportFormat, ReportExecutionResult } from '../types';
import { artifactPath, ensureExportDir } from '../jobs/artifactStore';

export interface CsvRenderOptions {
  streaming?: boolean;
}

const CANONICAL_HEADERS: Record<string, string> = {
  throughput: 'Throughput (MT)',
  yield: 'Yield (%)',
  rejection: 'Rejection rate (%)',
  oee: 'OEE (%)',
  actual_production: 'Actual production (MT)',
  planned_production: 'Planned production (MT)',
};

function headerLine(columns: string[]): string {
  return columns.map((c) => escapeCsvCell(CANONICAL_HEADERS[c] || c)).join(',');
}

function rowsChunk(columns: string[], rows: Record<string, unknown>[]): string {
  return rows.map((row) => columns.map((c) => escapeCsvCell(row[c])).join(',')).join('\n');
}

/**
 * Writes CSV artifact. Uses streamBatches when present for large exports.
 */
export async function renderCsv(
  jobId: string,
  result: ReportExecutionResult,
  _options?: CsvRenderOptions,
): Promise<{ filePath: string; sha256: string; bytes: number }> {
  const filePath = artifactPath(jobId, 'CSV' as ExportFormat);
  ensureExportDir();

  if (result.streamBatches) {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let columns = result.columns ?? [];
    let headerWritten = false;

    const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });

    for await (const batch of result.streamBatches()) {
      if (batch.length === 0) continue;
      if (!headerWritten) {
        if (!columns.length) columns = Object.keys(batch[0]);
        const header = headerLine(columns) + '\n';
        stream.write(header);
        hash.update(header);
        bytes += Buffer.byteLength(header, 'utf8');
        headerWritten = true;
      }
      const chunk = rowsChunk(columns, batch) + '\n';
      stream.write(chunk);
      hash.update(chunk);
      bytes += Buffer.byteLength(chunk, 'utf8');
    }

    if (!headerWritten) {
      stream.write('No data\n');
      hash.update('No data\n');
      bytes = 8;
    }

    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    return { filePath, sha256: hash.digest('hex'), bytes };
  }

  const sheets = result.sheets?.length ? result.sheets : [{ name: 'data', rows: result.rows }];

  if (sheets.length === 1) {
    const rows = sheets[0].rows;
    const columns = result.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
    const lines = rows.length === 0
      ? ''
      : [headerLine(columns), ...rows.map((r) => columns.map((c) => escapeCsvCell(r[c])).join(','))].join('\n');
    const content = Buffer.from(lines, 'utf8');
    fs.writeFileSync(filePath, content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    return { filePath, sha256, bytes: content.length };
  }

  const merged = sheets.flatMap((s) => s.rows.map((row) => ({ sheet: s.name, ...row })));
  const columns = Object.keys(merged[0] ?? {});
  const lines = [
    headerLine(columns),
    ...merged.map((r) =>
      columns.map((c) => escapeCsvCell((r as Record<string, unknown>)[c])).join(','),
    ),
  ].join('\n');
  const content = Buffer.from(lines, 'utf8');
  fs.writeFileSync(filePath, content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return { filePath, sha256, bytes: content.length };
}

export function openCsvStream(jobId: string): fs.WriteStream {
  const filePath = artifactPath(jobId, 'CSV');
  return fs.createWriteStream(filePath, { encoding: 'utf8' });
}
