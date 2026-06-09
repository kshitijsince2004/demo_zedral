import { describe, it, expect, vi } from 'vitest';
import { RawRegisterReport } from '../../src/export/definitions/RawRegisterReport';

const mockUser = {
  id: 1,
  roles: ['ADMIN'],
  lineAccess: [],
  lineScopes: [],
} as any;

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    coil_no: `C-${i}`,
    process_code: 'HRS',
    output_weight_mt: 1,
  }));
}

vi.mock('../../src/export/read/rawRegisterQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/read/rawRegisterQuery')>();
  return {
    ...actual,
    countRawRegisterRows: vi.fn(async () => 12_000),
    fetchRawRegisterRows: vi.fn(async () => ({
      rows: makeRows(100),
      parsed: { dateFrom: '2026-05-01', dateTo: '2026-05-31' },
      lines: ['HRS'],
    })),
    iterateRawRegisterBatches: vi.fn(async function* () {
      for (let i = 0; i < 120; i += 1) {
        yield makeRows(100);
      }
    }),
  };
});

describe('RAW CSV streaming (Phase 7)', () => {
  it('execute provides streamBatches for large CSV without preloading all rows in result', async () => {
    const result = await RawRegisterReport.execute(
      { dateFrom: '2026-05-01', dateTo: '2026-05-31' },
      'CSV',
      mockUser,
    );

    expect(result.streamBatches).toBeDefined();
    expect(result.rows).toHaveLength(0);

    let batches = 0;
    let rowCount = 0;
    for await (const batch of result.streamBatches!()) {
      batches += 1;
      rowCount += batch.length;
    }
    expect(batches).toBe(120);
    expect(rowCount).toBe(12_000);
  });
});
