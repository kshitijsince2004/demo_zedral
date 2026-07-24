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

  it('formats Date cells as plant IST datetime in CSV', () => {
    // 2026-07-07 14:00 IST = 08:30 UTC
    const at = new Date('2026-07-07T08:30:00.000Z');
    const cell = escapeCsvCell(at);
    expect(cell).not.toContain('T');
    expect(cell).not.toMatch(/Z$/);
    expect(cell).toMatch(/7/);
    expect(cell).toMatch(/2:?00|14/);
  });
});
