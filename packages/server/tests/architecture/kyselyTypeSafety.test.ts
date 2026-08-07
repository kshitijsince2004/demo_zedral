import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const serverSrc = path.resolve(__dirname, '../../src');
const guardedDirs = ['services/handover', 'export', 'services/reporting'];
const guardedFiles = ['services/PPCImportService.ts', 'services/ReportingService.ts'];

function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function findUnsafeKyselyCasts(content: string): string[] {
  const hits: string[] = [];
  const patterns = [
    /updateTable\([^)]*as any\)/,
    /selectFrom\([^)]*as any\)/,
    /insertInto\([^)]*as any\)/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(content)) hits.push(pattern.source);
  }
  return hits;
}

describe('Kysely query-builder type safety (audit M-4 guard)', () => {
  it('handover/import/reporting paths do not cast table names to any', () => {
    const violations: string[] = [];
    for (const rel of guardedDirs) {
      const dir = path.join(serverSrc, rel);
      if (!fs.existsSync(dir)) continue;
      for (const file of collectTsFiles(dir)) {
        const content = fs.readFileSync(file, 'utf8');
        const hits = findUnsafeKyselyCasts(content);
        if (hits.length > 0) {
          violations.push(`${path.relative(serverSrc, file)}: ${hits.join(', ')}`);
        }
      }
    }
    for (const rel of guardedFiles) {
      const file = path.join(serverSrc, rel);
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      const hits = findUnsafeKyselyCasts(content);
      if (hits.length > 0) {
        violations.push(`${rel}: ${hits.join(', ')}`);
      }
    }
    expect(violations, `Remove "as any" on Kysely table names:\n${violations.join('\n')}`).toEqual([]);
  });
});
