import { formatPlantDateTime } from '@m1/shared-validation';

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? formatPlantDateTime(value)
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
  ];
  return lines.join('\n');
}

/** Excel 2003 XML spreadsheet — opens in Excel without extra dependencies. */
export function rowsToSpreadsheetXml(rows: Record<string, unknown>[], sheetName = 'Export'): string {
  if (rows.length === 0) {
    return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${sheetName}"><Table></Table></Worksheet></Workbook>`;
  }
  const headers = Object.keys(rows[0]);
  const headerCells = headers
    .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('');
  const dataRows = rows
    .map((row) => {
      const cells = headers
        .map((h) => {
          const v = row[h];
          const type = typeof v === 'number' ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${type}">${escapeXml(v)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${escapeXml(sheetName)}">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

function escapeXml(value: unknown): string {
  const text =
    value instanceof Date
      ? formatPlantDateTime(value)
      : value == null
        ? ''
        : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
