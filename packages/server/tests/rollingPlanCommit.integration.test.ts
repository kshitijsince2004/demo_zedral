import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PPCImportRowSchema } from '@m1/shared-validation';
import { parseRollingPlanXlsx, type ParsedRollingPlanRow } from '../src/utils/rollingPlanXlsxParser';
import { db } from '../src/db';

const samplePath = path.resolve(__dirname, '../../../doc/ROLLLING PLAN.XLSX');

function productionSchemaInput(row: ParsedRollingPlanRow) {
  return {
    batch_number: row.batchNumber,
    plan_date: row.planDate,
    shift_code: row.shiftCode,
    machine_code: row.machineCode,
    sub_process: row.subProcess,
    coil_no: row.coilNo,
    slit_id: row.slitId,
    customer_name: row.customerName,
    grade_code: row.gradeCode,
    width_mm: row.widthMm,
    input_thk_mm: row.inputThkMm,
    ppc_thk_mm: row.passTargetThkMm ?? row.finishThkMm,
    ppc_weight_mt: row.ppcWeightMt,
    destination: row.destination,
    roll_finish: row.rollFinish,
    ppc_reroll_flag: row.ppcRerollFlag,
    sap_order_no: row.sapOrderNo,
    process_route: row.processRouteCanonical ?? row.processRouteRaw,
  };
}

describe('rolling plan commit diagnostics', () => {
  let dbUp = false;

  beforeAll(async () => {
    try {
      await db.selectFrom('master.shift').select('shift_code').limit(1).execute();
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  it.skipIf(!fs.existsSync(samplePath))('production schema input matches commit path', () => {
    const buf = fs.readFileSync(samplePath);
    const parsed = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
    const valid = parsed.rows.filter((r) => r.errors.length === 0);
    const schemaErrors: string[] = [];
    for (const row of valid) {
      const v = PPCImportRowSchema.safeParse(productionSchemaInput(row));
      if (!v.success) {
        schemaErrors.push(
          `${row.batchNumber}: ${v.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
        );
      }
    }
    if (schemaErrors.length > 0) {
      console.log('sample failures', schemaErrors.slice(0, 8));
    }
    expect(schemaErrors.length).toBe(0);
  });

  it.skipIf(!dbUp || !fs.existsSync(samplePath))('commit first valid row via PPCImportService', async () => {
    const { PPCImportService } = await import('../src/services/PPCImportService');
    const buf = fs.readFileSync(samplePath);
    const preview = await PPCImportService.previewRollingXlsx(buf, 'ROLLLING PLAN.XLSX', 1, 'ROLLING', 'B');
    expect(preview.headerError).toBeUndefined();
    const first = preview.rows.find((r) => r.errors.length === 0);
    expect(first).toBeDefined();
    const result = await PPCImportService.commitRollingSession(
      preview.sessionId,
      1,
      [first!.batchNumber],
    );
    if (result.loaded === 0) {
      console.log('commit errors', result.errors);
    }
    expect(result.loaded).toBe(1);
    expect(result.status).not.toBe('FAILED');
  });
});
