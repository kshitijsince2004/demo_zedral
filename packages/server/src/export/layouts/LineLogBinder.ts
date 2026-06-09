import type { RenderCell } from './types';
import type { LineLogLayout, LineLogRdm, LineLogSection } from './line_log/types';
import { loadLineLogLayout } from './line_log';

export interface BoundLineLogSheet {
  sheetName: string;
  cells: RenderCell[];
  tableRows: Record<string, unknown>[];
}

export interface BoundLineLogWorkbook {
  sheets: BoundLineLogSheet[];
  html: string;
}

export function bindLineLogWorkbook(rdm: LineLogRdm): BoundLineLogWorkbook {
  const layout = loadLineLogLayout(rdm.processCode);
  const sheets: BoundLineLogSheet[] = [];

  for (const shift of rdm.shifts) {
    const sheetName = `${shift.prodDate}_${shift.shiftCode}`.slice(0, 31);
    const cells: RenderCell[] = [];
    let row = 1;

    cells.push(cell(row++, 1, layout.title));
    cells.push(cell(row++, 1, `Document: ${layout.documentNumber}`));
    cells.push(cell(row++, 1, `Date: ${shift.prodDate}`));
    cells.push(cell(row++, 1, `Shift: ${shift.shiftCode}`));

    row = layout.body.startRow;
    layout.body.columns.forEach((col, idx) => {
      cells.push(cell(row, idx + 1, col.header));
    });
    row += 1;

    for (const body of shift.bodyRows) {
      layout.body.columns.forEach((col, idx) => {
        cells.push(cell(row, idx + 1, body[col.field] ?? null));
      });
      row += 1;
    }

    row = layout.stoppages.startRow;
    cells.push(cell(row++, 1, layout.stoppages.title));
    bindSectionHeader(cells, row, layout.stoppages);
    row += 1;
    for (const stop of shift.stoppages) {
      layout.stoppages.columns.forEach((col, idx) => {
        cells.push(cell(row, idx + 1, scalarCellValue((stop as Record<string, unknown>)[col.field])));
      });
      row += 1;
    }

    row = layout.crew.startRow;
    cells.push(cell(row++, 1, layout.crew.title));
    bindSectionHeader(cells, row, layout.crew);
    row += 1;
    for (const member of shift.crew) {
      layout.crew.columns.forEach((col, idx) => {
        const raw = member[col.field];
        const value =
          raw == null || typeof raw === 'object' ? null : (raw as string | number);
        cells.push(cell(row, idx + 1, value));
      });
      row += 1;
    }

    row = layout.signOff.row;
    layout.signOff.roles.forEach((role, idx) => {
      cells.push(cell(row, idx * 3 + 1, role));
      cells.push(cell(row, idx * 3 + 2, 'Signature: ____________'));
    });

    const tableRows = shift.bodyRows.map((r) => ({ ...r, prod_date: shift.prodDate, shift_code: shift.shiftCode }));
    sheets.push({ sheetName, cells, tableRows });
  }

  return { sheets, html: buildLineLogHtml(rdm, layout) };
}

function bindSectionHeader(cells: RenderCell[], row: number, section: LineLogSection) {
  section.columns.forEach((col, idx) => {
    cells.push(cell(row, idx + 1, col.header));
  });
}

function scalarCellValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

function cell(row: number, col: number, value: string | number | null): RenderCell {
  return { row, col, value };
}

function buildLineLogHtml(rdm: LineLogRdm, layout: LineLogLayout): string {
  const watermark = `Generated from M1 on ${rdm.generatedAt}`;
  const shiftBlocks = rdm.shifts.map((shift) => {
    const bodyHeader = layout.body.columns.map((c) => `<th>${c.header}</th>`).join('');
    const bodyRows = shift.bodyRows.map((row) => {
      const tds = layout.body.columns.map((c) => `<td>${row[c.field] ?? ''}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');

    const stopRows = shift.stoppages.map((s) => {
      const tds = layout.stoppages.columns.map((c) => `<td>${(s as Record<string, unknown>)[c.field] ?? ''}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('') || '<tr><td colspan="5">NIL</td></tr>';

    const crewRows = shift.crew.map((c) => {
      const tds = layout.crew.columns.map((col) => `<td>${c[col.field] ?? ''}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('') || '<tr><td colspan="2">NIL</td></tr>';

    const signOff = layout.signOff.roles.map((r) => `<div class="sign"><strong>${r}</strong><br/>Signature: ________________</div>`).join('');

    return `
      <section class="shift-block">
        <h2>${layout.title}</h2>
        <p class="meta">Document: ${layout.documentNumber} · Date: ${shift.prodDate} · Shift: ${shift.shiftCode}</p>
        <h3>${layout.body.title}</h3>
        <table><thead><tr>${bodyHeader}</tr></thead><tbody>${bodyRows || '<tr><td colspan="8">No entries</td></tr>'}</tbody></table>
        <h3>${layout.stoppages.title}</h3>
        <table><thead><tr>${layout.stoppages.columns.map((c) => `<th>${c.header}</th>`).join('')}</tr></thead><tbody>${stopRows}</tbody></table>
        <h3>${layout.crew.title}</h3>
        <table><thead><tr>${layout.crew.columns.map((c) => `<th>${c.header}</th>`).join('')}</tr></thead><tbody>${crewRows}</tbody></table>
        <div class="signoff">${signOff}</div>
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
  .watermark { position: fixed; top: 40%; left: 10%; opacity: 0.12; font-size: 28px; transform: rotate(-30deg); }
  h2 { margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  th, td { border: 1px solid #333; padding: 4px 6px; text-align: left; }
  th { background: #eee; }
  .signoff { display: flex; gap: 48px; margin-top: 24px; }
  .shift-block { page-break-after: always; }
</style></head><body>
  <div class="watermark">${watermark}</div>
  ${shiftBlocks}
</body></html>`;
}
