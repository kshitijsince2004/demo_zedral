import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as transferAudit from '../src/services/orderMachineTransferAudit';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('no runtime txn DDL', () => {
  it('does not CREATE TABLE from allocate / manual re-roll services', () => {
    for (const rel of [
      'src/services/orderMachineTransferAudit.ts',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/CREATE TABLE IF NOT EXISTS/i);
    }
    expect('ensureOrderMachineTransferTable' in transferAudit).toBe(false);
  });
});
