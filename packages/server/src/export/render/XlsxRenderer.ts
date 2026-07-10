import ExcelJS from 'exceljs';

import type { ExportFormat, RenderSheet, ReportExecutionResult } from '../types';

import { artifactPath, writeArtifact } from '../jobs/artifactStore';



const DETERMINISTIC_EPOCH = new Date('2026-01-01T00:00:00.000Z');



function sheetFromRows(name: string, rows: Record<string, unknown>[]): RenderSheet {

  return { name, rows };

}



function applyGridCells(

  ws: ExcelJS.Worksheet,

  cells: Array<{ row: number; col: number; value: string | number | null }>,

) {

  for (const { row, col, value } of cells) {

    const cell = ws.getCell(row, col);

    if (value === null) {
      cell.value = null;
    } else if (typeof value === 'number') {

      cell.value = value;

    } else {

      cell.value = value;

    }

  }

}



const CANONICAL_HEADERS: Record<string, string> = {
  throughput: 'Throughput (MT)',
  yield: 'Yield (%)',
  rejection: 'Order hold rate (%)',
  oee: 'OEE (%)',
  actual_production: 'Actual production (MT)',
  planned_production: 'Planned production (MT)',
};

function writeTableSheet(ws: ExcelJS.Worksheet, sheet: RenderSheet) {

  if (sheet.rows.length === 0) {

    ws.addRow(['No data']);

    return;

  }



  const columns = [...new Set(sheet.rows.flatMap((r) => Object.keys(r)))];

  ws.addRow(columns.map((c) => CANONICAL_HEADERS[c] || c));

  const header = ws.getRow(1);

  header.font = { bold: true };



  for (const row of sheet.rows) {

    ws.addRow(columns.map((c) => {

      const v = row[c];

      if (v == null) return '';

      if (typeof v === 'object') return JSON.stringify(v);

      return v;

    }));

  }



  ws.columns.forEach((col) => {

    col.width = Math.min(40, Math.max(10, (col.header as string)?.length ?? 10));

  });

}



export async function renderXlsx(

  jobId: string,

  result: ReportExecutionResult,

): Promise<{ filePath: string; sha256: string; bytes: number }> {

  if (result.templateBuffer) {
    const filePath = artifactPath(jobId, 'XLSX' as ExportFormat);
    const meta = writeArtifact(filePath, result.templateBuffer);
    return { filePath, ...meta };
  }

  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'M1 Export Module';

  workbook.created = result.deterministic ? DETERMINISTIC_EPOCH : new Date();

  workbook.modified = result.deterministic ? DETERMINISTIC_EPOCH : new Date();

  const auditParts = [
    result.dataVersion ? `dataVersion=${result.dataVersion}` : null,
    result.sourceRecordCount != null ? `sourceRecordCount=${result.sourceRecordCount}` : null,
    result.generatedAt ? `generatedAt=${result.generatedAt}` : null,
  ].filter(Boolean);
  if (auditParts.length) {
    workbook.keywords = auditParts.join(';');
  }



  if (result.gridSheets?.length) {

    for (const grid of result.gridSheets) {

      const ws = workbook.addWorksheet(grid.name.slice(0, 31));

      applyGridCells(ws, grid.cells);

    }

  } else {

    const sheets = result.sheets?.length

      ? result.sheets

      : [sheetFromRows('data', result.rows)];



    for (const sheet of sheets) {

      const ws = workbook.addWorksheet(sheet.name.slice(0, 31));

      writeTableSheet(ws, sheet);

    }

  }



  const filePath = artifactPath(jobId, 'XLSX' as ExportFormat);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const meta = writeArtifact(filePath, buffer);

  return { filePath, ...meta };

}


