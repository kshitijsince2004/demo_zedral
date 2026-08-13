import { describe, expect, it } from 'vitest';
import { isPklMhDesk } from '../src/lib/pklMhDesk';
import {
  assignIntervalLabels,
  buildLineChartData,
  buildLineTableRows,
  buildTankChartData,
  buildTankTableRows,
  filterPklSearch,
  filterTankChartRows,
  slicePklQueue,
  type PklChartRow,
} from '../src/lib/pklMhLiveSlice';

describe('pklMhDesk live routing', () => {
  it('treats sole PKL access as PKL desk', () => {
    expect(isPklMhDesk(['PKL'], null)).toBe(true);
    expect(isPklMhDesk(['PKL', 'ANN'], null)).toBe(false);
    expect(isPklMhDesk(['PKL', 'ANN'], 'PKL')).toBe(true);
  });
});

describe('pklMhLiveSlice', () => {
  const queue = [
    { coilNo: 'A', status: 'PENDING', customerName: 'X' },
    { coilNo: 'B', status: 'PREPARING', customerName: 'Y' },
    { coilNo: 'C', status: 'HOLD', customerName: 'Z' },
    { coilNo: 'D', status: 'COMPLETED', customerName: 'W' },
    { coilNo: 'E', status: 'IN_PROGRESS', customerName: 'V' },
  ];

  it('slicePklQueue filters orders tab', () => {
    expect(slicePklQueue(queue, 'orders').map((c) => c.coilNo)).toEqual(['A', 'B']);
  });

  it('slicePklQueue filters hold tab', () => {
    expect(slicePklQueue(queue, 'rejected').map((c) => c.coilNo)).toEqual(['C']);
  });

  it('slicePklQueue filters completed tab', () => {
    expect(slicePklQueue(queue, 'completed').map((c) => c.coilNo)).toEqual(['D']);
  });

  it('filterPklSearch matches coil and customer', () => {
    expect(filterPklSearch(queue, 'z').map((c) => c.coilNo)).toEqual(['C']);
    expect(filterPklSearch(queue, 'a').map((c) => c.coilNo)).toEqual(['A']);
  });

  it('filterTankChartRows keeps selected tank only', () => {
    const rows: PklChartRow[] = [
      { chart_time: '08:00', tank_no: 1, tank_level: 10, tank_temp_degc: 50, acid_strength_pct: 1, iron_strength_pct: 2 },
      { chart_time: '08:00', tank_no: 2, tank_level: 11, tank_temp_degc: 51, acid_strength_pct: 3, iron_strength_pct: 4 },
    ];
    expect(filterTankChartRows(rows, 2)).toHaveLength(1);
    expect(filterTankChartRows(rows, 2)[0].tank_no).toBe(2);
  });

  it('assignIntervalLabels maps per shift', () => {
    const rows: PklChartRow[] = [
      { chart_time: '08:00', tank_no: 1, tank_level: null, tank_temp_degc: null, acid_strength_pct: null, iron_strength_pct: null, shiftCode: 'A' },
      { chart_time: '10:00', tank_no: 1, tank_level: null, tank_temp_degc: null, acid_strength_pct: null, iron_strength_pct: null, shiftCode: 'A' },
      { chart_time: '08:00', tank_no: 1, tank_level: null, tank_temp_degc: null, acid_strength_pct: null, iron_strength_pct: null, shiftCode: 'B' },
    ];
    const labeled = assignIntervalLabels(rows, ['1st', '3rd', '5th']);
    expect(labeled.find((r) => r.chart_time === '08:00' && r.shiftCode === 'A')?.intervalLabel).toBe('1st');
    expect(labeled.find((r) => r.chart_time === '10:00' && r.shiftCode === 'A')?.intervalLabel).toBe('3rd');
    expect(labeled.find((r) => r.chart_time === '08:00' && r.shiftCode === 'B')?.intervalLabel).toBe('1st');
  });

  it('buildTankTableRows and chart data follow tank filter', () => {
    const rows: PklChartRow[] = assignIntervalLabels([
      { chart_time: '08:00', tank_no: 1, tank_level: 100, tank_temp_degc: 60, acid_strength_pct: 5, iron_strength_pct: 1, shiftCode: 'A' },
      { chart_time: '08:00', tank_no: 2, tank_level: 200, tank_temp_degc: 70, acid_strength_pct: 6, iron_strength_pct: 2, shiftCode: 'A' },
    ], ['1st']);
    const table = buildTankTableRows(rows, 1);
    expect(table).toHaveLength(1);
    expect(table[0].level).toBe('100');
    const chart = buildTankChartData(rows, 1);
    expect(chart).toHaveLength(1);
    expect(chart[0].temp).toBe(60);
  });

  it('buildLineTableRows and chart data use tank 1 line singletons', () => {
    const rows: PklChartRow[] = assignIntervalLabels([
      {
        chart_time: '08:00', tank_no: 1, tank_level: 100, tank_temp_degc: 60,
        acid_strength_pct: 5, iron_strength_pct: 1, shiftCode: 'A',
        steam_inlet_kgcm2: 1.2, dosage_acid: 3, line_incharge: 'Op A',
      },
      { chart_time: '08:00', tank_no: 2, tank_level: 200, tank_temp_degc: 70, acid_strength_pct: 6, iron_strength_pct: 2, shiftCode: 'A' },
    ], ['1st']);
    const lineTable = buildLineTableRows(rows);
    expect(lineTable).toHaveLength(1);
    expect(lineTable[0].steamInlet).toBe('1.2');
    expect(lineTable[0].lineIncharge).toBe('Op A');
    const lineChart = buildLineChartData(rows);
    expect(lineChart[0].dosageAcid).toBe(3);
  });
});
