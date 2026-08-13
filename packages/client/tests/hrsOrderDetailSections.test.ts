import { describe, expect, it } from 'vitest';
import {
  buildHrsOrderDetailSections,
  hrsPpcFields,
} from '../src/lib/hrsOrderDetailSections';
import type { ProcessQueueCard } from '../src/store/processStore';

const card = {
  coilNo: 'MC001',
  status: 'PREPARING',
  gradeCode: 'G1',
  customerName: 'Acme',
  widthMm: 1200,
  thicknessMm: 2.5,
  weightMt: 10.5,
  combination: '600+600',
  routeRaw: 'S-P-4',
} as ProcessQueueCard;

describe('hrsOrderDetailSections', () => {
  it('builds PPC and lifecycle sections', () => {
    const sections = buildHrsOrderDetailSections(card, {
      status: 'PREPARING',
      prodStartAt: '2026-08-12T10:00:00.000Z',
      shiftCode: 'A',
      orderLines: [{ batchNumber: 'B1', widthMm: 600, weightMt: 5 }],
    }, null);
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('ppc');
    expect(ids).toContain('lifecycle');
    expect(ids).toContain('lines');
    expect(sections.find((s) => s.id === 'ppc')?.fields.some((f) => f.label === 'Combination')).toBe(true);
  });

  it('includes capture when hrsCapture present', () => {
    const sections = buildHrsOrderDetailSections(card, null, {
      hrsCapture: {
        scrapMt: 0.1,
        slitSlots: [{ slot: 'A', targetWidthMm: 600, thicknessReadings: [{ thkMm: 2.4, time: '10:00' }] }],
      },
    });
    expect(sections.some((s) => s.id === 'capture')).toBe(true);
  });

  it('maps ppc fields from card and entry', () => {
    const ppc = hrsPpcFields(card, { customerName: 'Acme' }, { prefill: { heatNo: 'H99' } });
    expect(ppc.customer).toBe('Acme');
    expect(ppc.activeLineLabel).toBe('600+600');
  });
});
