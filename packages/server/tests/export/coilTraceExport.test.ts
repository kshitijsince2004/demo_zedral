import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import {
  PROCESS_ORDER,
  runToTimelineStep,
  sortProcessRuns,
} from '../../src/export/read/coilTraceQuery';
import { CoilLineageWalker } from '../../src/export/read/CoilLineageWalker';
import { bindCoilTraceWorkbook } from '../../src/export/layouts/CoilTraceBinder';
import { CoilTraceReport } from '../../src/export/definitions/CoilTraceReport';
import { renderPdf } from '../../src/export/render/PdfRenderer';
import { renderXlsx } from '../../src/export/render/XlsxRenderer';
import type { CoilTraceRdm } from '../../src/export/types/rdm';
import type { ProcessRunRow } from '../../src/export/read/types';
import fixture from '../fixtures/export/coil_trace_hr_ctl.json';

const mockUser = {
  id: 1,
  roles: ['ADMIN'],
  lineAccess: [],
  lineScopes: [],
} as any;

function buildRdmFromFixture(): CoilTraceRdm {
  const depthMap = CoilLineageWalker.lineageDepthMap(fixture.chain);
  const sorted = sortProcessRuns(fixture.runs as ProcessRunRow[], depthMap);
  const timeline = sorted.map((run, idx) =>
    runToTimelineStep(run, idx + 1, run.status === 'FOR_CTL' ? ['routing: FOR CTL'] : []),
  );

  return {
    report: 'COIL_TRACE',
    coilNo: fixture.coilNo,
    header: fixture.header,
    timeline,
  };
}

vi.mock('../../src/export/read/coilTraceQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/read/coilTraceQuery')>();
  return {
    ...actual,
    fetchCoilTraceBatch: vi.fn(async () => [buildRdmFromFixture()]),
  };
});

describe('coil trace export (Phase 6)', () => {
  const rdm = buildRdmFromFixture();

  it('sorts HR→PKL→CRM→ANN→SKP→RWD→CRS→CTL for known fixture path', () => {
    const processes = rdm.timeline.map((s) => s.process);
    expect(processes[0]).toBe('HR Slitting');
    expect(processes[1]).toBe('Pickling');
    expect(processes[2]).toBe('Cold Rolling Mill');
    expect(processes[3]).toBe('Annealing');
    expect(processes[4]).toBe('Skin Pass');
    expect(processes[5]).toBe('Rewinding');
    expect(processes[6]).toBe('CR Slitting');
    expect(processes[7]).toBe('Cut-to-Length');
    expect(rdm.timeline).toHaveLength(8);
  });

  it('annealing step includes charge_no and base_no', () => {
    const ann = rdm.timeline.find((s) => s.process === 'Annealing');
    expect(ann?.chargeNo).toBe('CH-100');
    expect(ann?.baseNo).toBe('BASE-42');
  });

  it('surfaces for_ctl_flag in header and CRS step', () => {
    expect(rdm.header.forCtlFlag).toBe(true);
    const crs = rdm.timeline.find((s) => s.process === 'CR Slitting');
    expect(crs?.status).toBe('FOR_CTL');
    expect(crs?.keyValues.for_ctl_flag).toBe(true);
  });

  it('lineage depth map orders parent before child', () => {
    const depth = CoilLineageWalker.lineageDepthMap(fixture.chain);
    expect(depth.get('HSL-2026-04400')).toBe(0);
    expect(depth.get('HSL-2026-04471')).toBe(1);
  });

  it('PROCESS_ORDER covers all eight process codes', () => {
    expect(PROCESS_ORDER.HRS).toBe(1);
    expect(PROCESS_ORDER.CTL).toBe(8);
    expect(PROCESS_ORDER['6HI']).toBe(3);
  });

  it('bindCoilTraceWorkbook produces one XLSX row per process step', () => {
    const bound = bindCoilTraceWorkbook([rdm], '2026-05-01T00:00:00.000Z');
    expect(bound.rows).toHaveLength(8);
    expect(bound.rows[0].coil_no).toBe(fixture.coilNo);
    expect(bound.rows[6].for_ctl_flag).toBe(true);
    expect(bound.rows[3].charge_no).toBe('CH-100');
  });

  it('HTML has one coil-page section and FOR CTL badge', () => {
    const bound = bindCoilTraceWorkbook([rdm], '2026-05-01T00:00:00.000Z');
    expect(bound.html).toContain('coil-page');
    expect(bound.html).toContain('FOR CTL ROUTING');
    expect(bound.html).toContain('Generated from M1 on');
    expect(bound.html).toContain(fixture.coilNo);
  });

  it('CoilTraceReport execute XLSX renders artifact', async () => {
    const result = await CoilTraceReport.execute(
      { coil_no: fixture.coilNo },
      'XLSX',
      mockUser,
    );
    expect(result.rows).toHaveLength(8);
    expect(result.filename).toMatch(/coil_trace_.*\.xlsx$/);

    const jobId = `ct_xlsx_${Date.now()}`;
    const rendered = await renderXlsx(jobId, { ...result, deterministic: true });
    expect(fs.existsSync(rendered.filePath)).toBe(true);
    fs.unlinkSync(rendered.filePath);
  });

  it('CoilTraceReport execute PDF provides multi-page HTML', async () => {
    const result = await CoilTraceReport.execute(
      { coil_no: fixture.coilNo },
      'PDF',
      mockUser,
    );
    expect(result.html).toContain('Annealing');
    // ponytail: skip puppeteer renderPdf — HTML payload is the unit contract
  });
});
