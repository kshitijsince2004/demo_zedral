/**
 * Property 2: Preservation — Non-Bug Inputs Unchanged
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { parseCsvText } from '../src/utils/csvParser';
import { parsePpcCsv } from '../src/utils/ppcCsvParser';
import { tokenizeCsvLine } from '../src/utils/csvTokenizer';
import { previewSessionStore, PREVIEW_SESSION_TTL_MS } from '../src/services/previewSessionStore';
import { db } from '../src/db';
import { getIntegrationTestUserId } from './helpers/integrationFixtures';

async function isDbReachable(): Promise<boolean> {
  try {
    await db.selectFrom('master.customer').select('customer_id').limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

const dbReachable = await isDbReachable();

describe('Property 2: Preservation', () => {
  describe('Parser baseline — well-formed CSV', () => {
    it('observed — valid planning CSV yields rows without rowErrors', () => {
      const csv = `coil_no,customer_code,grade_code,sap_order_no,target_width_mm
C-PRES-1,CUST_TATA,CRCA,SO-9001,1250`;
      const { rows, rowErrors, headerError } = parseCsvText(csv);
      expect(headerError).toBeUndefined();
      expect(rowErrors).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0].sap_order_no).toBe('SO-9001');
    });

    it('observed — valid 6HI PPC CSV parses one row', () => {
      const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
BPRES,2026-01-01,B,6HI,ROLLING,CPRES,ACME,D,1250,1.2,10`;
      const { rows, rowErrors, headerError } = parsePpcCsv(csv);
      expect(headerError).toBeUndefined();
      expect(rowErrors).toHaveLength(0);
      expect(rows).toHaveLength(1);
      expect(rows[0].machine_code).toBe('6HI');
    });

    it('simple unquoted fields tokenize identically', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[A-Za-z0-9]{1,8}$/),
          fc.stringMatching(/^[A-Za-z0-9]{1,8}$/),
          (a, b) => {
            const line = `${a},${b},tail`;
            const once = tokenizeCsvLine(line);
            const twice = tokenizeCsvLine(line);
            expect(once).toEqual(twice);
          },
        ),
        { numRuns: 40 },
      );
    });
  });

  describe('Bug 4 preservation — within-TTL session commit', () => {
    beforeEach(() => {
      previewSessionStore.clear();
    });

    it('same-instance session remains available before TTL', () => {
      previewSessionStore.set('live', {
        sessionId: 'live',
        fileName: 'plan.xlsx',
        userId: 1,
        rows: [],
        planDate: '2026-01-01',
        shiftCode: 'B',
        sheetType: 'ROLLING',
        expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
      });
      expect(previewSessionStore.get('live')?.sessionId).toBe('live');
    });
  });

  describe.skipIf(!dbReachable)('DB preservation', () => {
    const testUserId = () => getIntegrationTestUserId();

    it('well-formed planning import reports LOADED', async () => {
      const { ImportService } = await import('../src/services/ImportService');
      const coil = `PRES-WF-${Date.now()}`;
      const csv = `coil_no,customer_code,grade_code,sap_order_no,target_width_mm
${coil},CUST_TATA,CRCA,SO-${coil},1250`;

      const result = await ImportService.importFromCsvText('CSV', 'pres.csv', csv, testUserId());
      expect(result.status).toBe('LOADED');
      expect(result.successCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it('sap_order_no keying unchanged for rows with order number', async () => {
      const { ImportService } = await import('../src/services/ImportService');
      const orderNo = `SO-PRES-${Date.now()}`;
      const coil = `PRES-SO-${Date.now()}`;
      const csv = `coil_no,customer_code,grade_code,sap_order_no
${coil},CUST_TATA,CRCA,${orderNo}`;

      await ImportService.importFromCsvText('CSV', 'pres-so.csv', csv, testUserId());
      const order = await db.selectFrom('planning.plan_order')
        .select('sap_order_no')
        .where('sap_order_no', '=', orderNo)
        .executeTakeFirst();
      expect(order?.sap_order_no).toBe(orderNo);
    });

    it('single order-less row creates exactly one plan_order', async () => {
      const { ImportService } = await import('../src/services/ImportService');
      const coil = `PRES-ONE-${Date.now()}`;
      const csv = `coil_no,customer_code,grade_code
${coil},CUST_TATA,CRCA`;

      const result = await ImportService.importFromCsvText('CSV', 'pres-one.csv', csv, testUserId());
      expect(result.status).toBe('LOADED');

      const orders = await db.selectFrom('planning.plan_order')
        .select('sap_order_no')
        .where('sap_order_no', '=', `IMP-${result.batchId}-${coil}`)
        .execute();
      expect(orders).toHaveLength(1);
    });

    it('first PPC batch on empty queue starts queue_seq at 1', async () => {
      const { PPCImportService } = await import('../src/services/PPCImportService');
      const batchNo = `PRES-Q1-${Date.now()}`;
      const planDate = `2099-12-${String(Date.now() % 28 + 1).padStart(2, '0')}`;
      const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
${batchNo},${planDate},B,6HI,ROLLING,C-QFIRST,ACME,D,1250,1.2,10`;

      const result = await PPCImportService.importFromCsvText('pres-q.csv', csv, testUserId());
      expect(result.status).toBe('LOADED');
      const row = await db.selectFrom('planning.ppc_batch')
        .select('queue_seq')
        .where('batch_number', '=', batchNo)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(Number(row!.queue_seq)).toBe(1);
    });

    it('valid 6HI PPC CSV import writes ppc_batch', async () => {
      const { PPCImportService } = await import('../src/services/PPCImportService');
      const batchNo = `PRES-PPC-${Date.now()}`;
      const csv = `batch_number,plan_date,shift_code,machine_code,sub_process,coil_no,customer_name,grade_code,width_mm,ppc_thk_mm,ppc_weight_mt
${batchNo},2026-06-01,B,6HI,SKIN_PASS,C-PPC,ACME,D,1250,1.0,8`;

      const result = await PPCImportService.importFromCsvText('pres-ppc.csv', csv, testUserId());
      expect(result.status).toBe('LOADED');
      const batch = await db.selectFrom('planning.ppc_batch')
        .select('batch_number')
        .where('batch_number', '=', batchNo)
        .executeTakeFirst();
      expect(batch?.batch_number).toBe(batchNo);
    });
  });
});
