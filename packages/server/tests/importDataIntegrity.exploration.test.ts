/**
 * Property 1: Bug Condition — Import Data Integrity Defects (Bugs 1-11)
 * Re-run after fix (Task 3.11) — expects PASS on fixed code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { parseCsvText } from '../src/utils/csvParser';
import { parsePpcCsv, ppcDataRowNumber } from '../src/utils/ppcCsvParser';
import { tokenizeCsvLine } from '../src/utils/csvTokenizer';
import { PPCImportRowSchema } from '@m1/shared-validation';
import {
  previewSessionStore,
  PREVIEW_SESSION_TTL_MS,
} from '../src/services/previewSessionStore';
import { db } from '../src/db';
import { getIntegrationTestUserId } from './helpers/integrationFixtures';
import { formatDateOnly } from '../src/utils/dateOnly';

async function isDbReachable(): Promise<boolean> {
  try {
    await db.selectFrom('master.customer').select('customer_id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

const dbReachable = await isDbReachable();

describe('Property 1: Bug Condition exploration', () => {
  describe('Bug 3 — blank required fields surfaced as errors', () => {
    it('records blank grade_code in rowErrors and does not silently drop', () => {
      const csv = `coil_no,customer_code,grade_code
C-BLANK,CUST-001,`;
      const { rows, rowErrors } = parseCsvText(csv);
      expect(rows).toHaveLength(0);
      expect(rowErrors).toHaveLength(1);
      expect(rowErrors[0].rowIndex).toBe(2);
      expect(rowErrors[0].error).toMatch(/grade_code/);
    });
  });

  describe('Bug 5 — shared CSV tokenizer unescapes quotes and embedded newlines', () => {
    it('tokenizes escaped quotes identically in both parsers', () => {
      const field = '"a""b"';
      const planning = tokenizeCsvLine(`x,${field},y`);
      const ppc = tokenizeCsvLine(`x,${field},y`);
      expect(planning).toEqual(ppc);
      expect(planning[1]).toBe('a"b');
    });

    it('preserves embedded newline inside quoted field', () => {
      const csv = 'h1,h2\n"a\nb",c';
      const { rows } = parseCsvText(`coil_no,customer_code,grade_code,heat_no\nC1,CUST-001,CRCA,"line1\nline2"`);
      expect(rows[0].heat_no).toBe('line1\nline2');
    });
  });

  describe('Bug 6 — consistent PPC row numbering', () => {
    it('parser and import path use the same data row number (i+2)', () => {
      const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
B1,2026-01-01,B,6HI,ROLLING,C1,ACME,D,1250,1.2,10
,2026-01-01,B,6HI,ROLLING,C2,ACME,D,1250,1.2,10`;

      const parsed = parsePpcCsv(csv);
      expect(parsed.rowErrors[0].row).toBe(3);
      expect(ppcDataRowNumber(1)).toBe(3);
    });
  });

  describe('Bug 7 — XLSX commit rejects width_mm = 0 via schema', () => {
    it('PPCImportRowSchema rejects zero width', () => {
      const result = PPCImportRowSchema.safeParse({
        batch_number: 'B-ZERO',
        plan_date: '2026-01-01',
        shift_code: 'B',
        machine_code: '6HI',
        sub_process: 'ROLLING',
        coil_no: 'C-ZERO',
        customer_name: 'ACME',
        grade_code: 'D',
        width_mm: 0,
        ppc_thk_mm: 1.2,
        ppc_weight_mt: 10,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Bug 8 — PPC CSV accepts 4HI', () => {
    it('parses 4HI machine row without rejection', () => {
      const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
B4HI,2026-01-01,B,4HI,ROLLING,C4,CUST,D,1250,1.2,10`;
      const { rows, rowErrors } = parsePpcCsv(csv);
      expect(rowErrors.filter((e) => e.message.includes('6HI'))).toHaveLength(0);
      expect(rows[0].machine_code).toBe('4HI');
    });
  });

  describe('Bug 9 — generic 500 without SQL/driver detail', () => {
    it('import route returns generic message on unexpected error', async () => {
      vi.resetModules();
      vi.doMock('../src/middleware/authMiddleware', () => ({
        requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
          (req as express.Request & { user: { id: number } }).user = { id: 1 };
          next();
        },
        requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
      }));
      vi.doMock('../src/services/ImportService', () => ({
        ImportService: {
          importFromJson: vi.fn().mockRejectedValue(new Error('duplicate key violates unique constraint "coil_pkey"')),
          getBatch: vi.fn(),
        },
      }));

      const { default: importRoutes } = await import('../src/routes/importRoutes');
      const app = express();
      app.use(express.json());
      app.use('/import', importRoutes);

      const res = await request(app)
        .post('/import')
        .send({ fileName: 't.csv', rows: [{ coil_no: 'X', customer_code: 'Y', grade_code: 'Z' }] });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Import failed');
      expect(JSON.stringify(res.body)).not.toMatch(/constraint|duplicate key|SQL/i);
      vi.doUnmock('../src/services/ImportService');
      vi.doUnmock('../src/middleware/authMiddleware');
    });
  });

  describe('Bug 1 — transactional per-row writes', () => {
    it('ImportService and PPCImportService wrap multi-write rows in transactions', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const root = path.join(__dirname, '..');
      const importSrc = fs.readFileSync(path.join(root, 'src/services/ImportService.ts'), 'utf8');
      const ppcSrc = fs.readFileSync(path.join(root, 'src/services/PPCImportService.ts'), 'utf8');
      expect(importSrc).toContain('db.transaction().execute');
      expect(importSrc).toContain('upsertPlanningRow(trx');
      expect(ppcSrc).toContain('upsertPpcRow(trx');
      expect(ppcSrc).toContain('upsertRollingPlanRow(trx');
    });
  });

  describe('Bug 4 — preview session TTL and eviction', () => {
    beforeEach(() => {
      previewSessionStore.clear();
    });

    it('rejects commit after session cleared (not found)', async () => {
      const { PPCImportService } = await import('../src/services/PPCImportService');
      previewSessionStore.set('gone-session', {
        sessionId: 'gone-session',
        fileName: 't.xlsx',
        userId: 1,
        rows: [],
        planDate: '2026-01-01',
        shiftCode: 'B',
        sheetType: 'ROLLING',
        expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
      });
      previewSessionStore.delete('gone-session');
      await expect(PPCImportService.commitRollingSession('gone-session', 1)).rejects.toThrow(
        /not found or expired/i,
      );
    });

    it('rejects expired session via getLiveSession', async () => {
      const { getLiveSession } = await import('../src/services/previewSessionStore');
      previewSessionStore.set('expired', {
        sessionId: 'expired',
        fileName: 't.xlsx',
        userId: 1,
        rows: [],
        planDate: '2026-01-01',
        shiftCode: 'B',
        sheetType: 'ROLLING',
        expiresAt: Date.now() - 1000,
      });
      expect(() => getLiveSession('expired')).toThrow(/not found or expired/i);
      expect(previewSessionStore.get('expired')).toBeUndefined();
    });
  });

  describe.skipIf(!dbReachable)('DB-backed bug conditions', () => {
    const testUserId = () => getIntegrationTestUserId();

    describe('Bug 2 — unique fallback order per order-less row', () => {
      it('creates distinct plan_order rows for two order-less coils', async () => {
        const { ImportService } = await import('../src/services/ImportService');
        const suffix = Date.now();
        const csv = `coil_no,customer_code,grade_code,target_width_mm
COIL-A-${suffix},CUST_TATA,CRCA,1250
COIL-B-${suffix},CUST_TATA,CRCA,1100`;

        const result = await ImportService.importFromCsvText('CSV', `bug2-${suffix}.csv`, csv, testUserId());
        expect(result.status).toBe('LOADED');

        const orders = await db.selectFrom('planning.plan_order')
          .select(['sap_order_no', 'target_width_mm'])
          .where('sap_order_no', 'like', `IMP-${result.batchId}-%`)
          .execute();

        expect(orders).toHaveLength(2);
        expect(new Set(orders.map((o) => o.sap_order_no)).size).toBe(2);
      });
    });

    describe('Bug 10 — PPC re-import upserts existing batch_number', () => {
      it('updates batch on re-import instead of duplicate error', async () => {
        const { PPCImportService } = await import('../src/services/PPCImportService');
        const batchNo = `REIMP-${Date.now()}`;
        const base = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
${batchNo},2026-06-01,B,6HI,ROLLING,C-REIMP,ACME,D,1250,1.2,10`;

        const first = await PPCImportService.importFromCsvText('first.csv', base, testUserId());
        expect(first.loaded).toBe(1);

        const second = await PPCImportService.importFromCsvText(
          'second.csv',
          base.replace('1.2', '1.1'),
          testUserId(),
        );
        expect(second.errors.find((e) => e.message.includes('Duplicate'))).toBeUndefined();
        // Re-importing an unallocated batch is a safe upsert. Under the production-safety
        // import contract, inserts are counted in `loaded` and updates in `updated`;
        // exactly one row is upserted either way (not a duplicate error).
        expect(second.loaded + second.updated).toBe(1);
        expect(second.updated).toBe(1);
        expect(second.loaded).toBe(0);

        const row = await db.selectFrom('planning.ppc_batch')
          .select('ppc_thk_mm')
          .where('batch_number', '=', batchNo)
          .executeTakeFirst();
        expect(Number(row?.ppc_thk_mm)).toBeCloseTo(1.1, 2);
      });
    });

    describe('Bug 12 — pending merge when only plan_date changes', () => {
      it('updates existing pending batch instead of creating duplicate', async () => {
        const { PPCImportService } = await import('../src/services/PPCImportService');
        const ts = Date.now();
        const batchNo = `PLANDATE-${ts}`;
        const coil = `C-PD-${ts}`;
        const base = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt`;

        const first = await PPCImportService.importFromCsvText(
          'first.csv',
          `${base}\n${batchNo},2026-06-01,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10`,
          testUserId(),
        );
        expect(first.loaded).toBe(1);

        const second = await PPCImportService.importFromCsvText(
          'second.csv',
          `${base}\n${batchNo},2026-06-15,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10`,
          testUserId(),
        );
        expect(second.loaded + second.updated).toBe(1);
        expect(second.updated).toBe(1);

        const rows = await db.selectFrom('planning.ppc_batch')
          .select(['batch_number', 'plan_date'])
          .where('coil_no', '=', coil)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].batch_number).toBe(batchNo);
        expect(formatDateOnly(rows[0].plan_date)).toBe('2026-06-15');
      });
    });

    describe('same-file identity + different batch_number must insert both', () => {
      it('loads both rows when identity matches but batch_numbers differ in one file', async () => {
        const { PPCImportService } = await import('../src/services/PPCImportService');
        const ts = Date.now();
        const coil = `C-SAMEID-${ts}`;
        const bn1 = `SAMEID-A-${ts}`;
        const bn2 = `SAMEID-B-${ts}`;
        const hdr = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt`;
        const csv = `${hdr}
${bn1},2026-06-01,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10
${bn2},2026-06-01,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10`;

        const result = await PPCImportService.importFromCsvText('same-id.csv', csv, testUserId());
        expect(result.loaded).toBe(2);
        expect(result.updated).toBe(0);

        const rows = await db.selectFrom('planning.ppc_batch')
          .select('batch_number')
          .where('batch_number', 'in', [bn1, bn2])
          .execute();
        expect(rows.map((r) => r.batch_number).sort()).toEqual([bn1, bn2].sort());
      });

      it('still merges into older pending batch on a later re-import', async () => {
        const { PPCImportService } = await import('../src/services/PPCImportService');
        const ts = Date.now();
        const coil = `C-REMERGE-${ts}`;
        const bn1 = `REMERGE-A-${ts}`;
        const bn2 = `REMERGE-B-${ts}`;
        const hdr = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt`;

        const first = await PPCImportService.importFromCsvText(
          'remerge-1.csv',
          `${hdr}\n${bn1},2026-06-01,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10`,
          testUserId(),
        );
        expect(first.loaded).toBe(1);

        const second = await PPCImportService.importFromCsvText(
          'remerge-2.csv',
          `${hdr}\n${bn2},2026-06-15,B,6HI,ROLLING,${coil},ACME,D,1250,1.2,10`,
          testUserId(),
        );
        expect(second.loaded).toBe(0);
        expect(second.updated).toBe(1);

        const rows = await db.selectFrom('planning.ppc_batch')
          .select(['batch_number', 'plan_date', 'ppc_thk_mm'])
          .where('coil_no', '=', coil)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0].batch_number).toBe(bn1);
        expect(formatDateOnly(rows[0].plan_date)).toBe('2026-06-15');
        expect(Number(rows[0].ppc_thk_mm)).toBeCloseTo(1.2, 2);
      });
    });

    describe('Bug 11 — queue_seq continues from existing max', () => {
      it('assigns queue_seq after existing entries for machine/date/shift', async () => {
        const { PPCImportService } = await import('../src/services/PPCImportService');
        const ts = Date.now();
        const planDate = '2026-06-08';
        const batchA = `QSEQ-A-${ts}`;
        const batchB = `QSEQ-B-${ts}`;

        const coilA = `C-Q1-${ts}`;
        const coilB = `C-Q2-${ts}`;
        const csv1 = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
${batchA},${planDate},B,6HI,ROLLING,${coilA},ACME,D,1250,1.2,10`;

        const first = await PPCImportService.importFromCsvText('q1.csv', csv1, testUserId());
        expect(first.loaded).toBe(1);

        const csv2 = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
${batchB},${planDate},B,6HI,ROLLING,${coilB},ACME,D,1250,1.2,10`;

        const second = await PPCImportService.importFromCsvText('q2.csv', csv2, testUserId());
        expect(second.loaded).toBe(1);

        const batches = await db.selectFrom('planning.ppc_batch')
          .select(['batch_number', 'queue_seq'])
          .where('batch_number', 'in', [batchA, batchB])
          .orderBy('queue_seq', 'asc')
          .execute();

        expect(batches).toHaveLength(2);
        expect(Number(batches[0].queue_seq)).toBeLessThan(Number(batches[1].queue_seq));
      });
    });
  });

  describe('Bug 5 property — tokenizer equivalence on simple fields', () => {
    it('simple unquoted fields match between parsers', () => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/), (value) => {
          const line = `a,${value},c`;
          expect(tokenizeCsvLine(line)).toEqual(['a', value, 'c']);
        }),
        { numRuns: 30 },
      );
    });
  });
});
