import { describe, it, expect } from 'vitest';
import { escapeCsvCell, rowsToCsv, rowsToSpreadsheetXml } from '../src/utils/csvWriter';

describe('csvWriter', () => {
  it('escapes commas and quotes in CSV cells', () => {
    expect(escapeCsvCell('hello, world')).toBe('"hello, world"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders rows to CSV with header row', () => {
    const csv = rowsToCsv([
      { coil_no: 'C1', weight_mt: 25 },
      { coil_no: 'C2', weight_mt: 30 },
    ]);
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).toContain('coil_no,weight_mt');
    expect(csv).toContain('C1,25');
  });

  it('renders spreadsheet XML with row data', () => {
    const xml = rowsToSpreadsheetXml([{ coil_no: 'C1', weight_mt: 25 }]);
    expect(xml).toContain('<Workbook');
    expect(xml).toContain('coil_no');
    expect(xml).toContain('C1');
  });
});
