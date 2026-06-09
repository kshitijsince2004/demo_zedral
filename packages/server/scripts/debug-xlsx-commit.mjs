#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseRollingPlanXlsx } from '../dist/utils/rollingPlanXlsxParser.js';
import { PPCImportRowSchema } from '@m1/shared-validation';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const buf = fs.readFileSync(path.join(root, 'doc/ROLLLING PLAN.XLSX'));
const parsed = parseRollingPlanXlsx(buf, { sheetType: 'ROLLING', shiftCode: 'B' });
const valid = parsed.rows.filter((r) => r.errors.length === 0);
console.log('valid', valid.length, 'parser errors', parsed.rows.length - valid.length);

const failReasons = new Map();
for (const row of valid) {
  const input = {
    batch_number: row.batchNumber,
    plan_date: row.planDate,
    shift_code: row.shiftCode,
    machine_code: row.machineCode,
    sub_process: row.subProcess ?? 'ROLLING',
    coil_no: row.coilNo,
    customer_name: row.customerName,
    grade_code: row.gradeCode,
    width_mm: row.widthMm,
    input_thk_mm: row.inputThkMm,
    ppc_thk_mm: row.passTargetThkMm ?? row.finishThkMm,
    ppc_weight_mt: row.ppcWeightMt,
  };
  const v = PPCImportRowSchema.safeParse(input);
  if (!v.success) {
    const msg = v.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    failReasons.set(msg, (failReasons.get(msg) ?? 0) + 1);
  }
}
console.log('schema failure reasons:', [...failReasons.entries()].slice(0, 10));
