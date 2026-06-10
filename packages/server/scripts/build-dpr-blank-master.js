/**
 * One-time script: build dpr_blank_master.xlsx from the structure template.
 * Strips all prefilled production/stoppage/scrap values; keeps formulas and layout.
 *
 * Usage: node packages/server/scripts/build-dpr-blank-master.js
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const BLOCK_STRIDE = 46;
function titleRow(n) {
  if (n === 1) return 2;
  return 49 + (n - 2) * BLOCK_STRIDE;
}

const AREA_OFFSETS = [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29];
const MACHINE_INPUT_COLS = [
  2,3,4,5,26,27,28,30,31,32,34,35,36,38,39,40,42,44,45,46,54,55,56,
  61,62,63,64,65,66,67,68,69,70,71,72,
];
const SUMMARY = [
  { offset: 28, cols: [6] },
  { offset: 29, cols: [2,3,4,5] },
  { offset: 32, cols: [11,12,13,14,15,16] },
  { offset: 33, cols: [11,12,13,14,15,16] },
  { offset: 34, cols: [11,12,13,14,15,16] },
  { offset: 37, cols: [11,12,13,14,15,16] },
  { offset: 38, cols: [11,12,13,14,15,16] },
  { offset: 39, cols: [11,12,13,14,15,16] },
  { offset: 40, cols: [11,12,13,14,15,16] },
];

async function main() {
  const root = path.resolve(__dirname, '..');
  const src = path.join(root, 'assets', 'dpr', 'dpr_master_template.xlsx');
  const out = path.join(root, 'assets', 'dpr', 'dpr_blank_master.xlsx');
  if (!fs.existsSync(src)) {
    console.error('Source template missing:', src);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const main = wb.worksheets[0];
  const delay = wb.getWorksheet('DELAY');

  for (let day = 1; day <= 31; day++) {
    const base = titleRow(day);
    for (const offset of AREA_OFFSETS) {
      const row = base + offset;
      for (const col of MACHINE_INPUT_COLS) main.getCell(row, col).value = 0;
    }
    for (const { offset, cols } of SUMMARY) {
      const row = base + offset;
      for (const col of cols) main.getCell(row, col).value = 0;
    }
  }

  if (delay) {
    delay.eachRow((row) => {
      const label = String(row.getCell(1).value ?? '').trim();
      if (!label || label === 'LINE') return;
      row.getCell(4).value = 0;
      row.getCell(5).value = '';
      row.getCell(6).value = '';
    });
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log('Wrote blank master:', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
