import { describe, it, expect } from 'vitest';
import {
  assertExportPermission,
  filterRunsByAreaAccess,
  getScopedDprAreaCodes,
} from '../../src/export/auth/exportAuthz';
import { removePartialArtifact } from '../../src/export/jobs/objectStorage';
import { ASYNC_ROW_THRESHOLD, parseExportRequest } from '../../src/export/jobs/ExportJobService';
import fs from 'fs';
import path from 'path';
import os from 'os';

const adminUser = {
  id: 1,
  roles: ['ADMIN'],
  lineAccess: [],
  lineScopes: [],
} as any;

const hrsSupervisor = {
  id: 2,
  roles: ['SUPERVISOR'],
  lineAccess: ['HRS'],
  lineScopes: [{ code: 'HRS', accessLevel: 'APPROVE' }],
} as any;

describe('export phase 7 — authz & infra', () => {
  it('assertExportPermission allows supervisor with line scope', () => {
    expect(() => assertExportPermission(hrsSupervisor, 'RAW', {})).not.toThrow();
  });

  it('assertExportPermission rejects operator role', () => {
    const op = { id: 3, roles: ['OPERATOR'], lineAccess: ['HRS'], lineScopes: [] } as any;
    expect(() => assertExportPermission(op, 'RAW', {})).toThrow(/Forbidden/);
  });

  it('getScopedDprAreaCodes maps HRS supervisor to HRS area only', () => {
    const areas = getScopedDprAreaCodes(hrsSupervisor);
    expect(areas).toEqual(['HRS']);
  });

  it('filterRunsByAreaAccess limits rows for scoped supervisor', () => {
    const rows = [
      { areaCode: 'HRS', coilNo: 'C1' },
      { areaCode: 'PKLG', coilNo: 'C2' },
    ];
    const filtered = filterRunsByAreaAccess(hrsSupervisor, rows);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].areaCode).toBe('HRS');
  });

  it('admin has unrestricted DPR area filter', () => {
    expect(getScopedDprAreaCodes(adminUser)).toBeNull();
    const rows = [{ areaCode: 'PKLG' }, { areaCode: 'HRS' }];
    expect(filterRunsByAreaAccess(adminUser, rows)).toHaveLength(2);
  });

  it('machine head is scoped to assigned machine areas', () => {
    const mh = {
      id: 4,
      roles: ['MACHINE_HEAD'],
      lineAccess: [],
      lineScopes: [],
      machineAccess: ['4HI'],
    } as any;
    expect(() => assertExportPermission(mh, 'DPR', {})).not.toThrow();
    const areas = getScopedDprAreaCodes(mh);
    expect(areas).toContain('4HI_R');
    expect(areas).not.toContain('HRS');
  });

  it('plant head has unrestricted DPR area filter', () => {
    const ph = { id: 5, roles: ['PLANT_HEAD'], lineAccess: [], lineScopes: [] } as any;
    expect(getScopedDprAreaCodes(ph)).toBeNull();
  });

  it('parseExportRequest stores format for worker replay', () => {
    const req = parseExportRequest({
      type: 'DPR',
      format: 'xlsx',
      scope: { month: '2026-05' },
    });
    expect(req.format).toBe('XLSX');
    expect(req.type).toBe('DPR');
  });

  it('ASYNC_ROW_THRESHOLD is 10000', () => {
    expect(ASYNC_ROW_THRESHOLD).toBe(10000);
  });

  it('removePartialArtifact deletes local temp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-p7-'));
    const file = path.join(dir, 'export_test.csv');
    fs.writeFileSync(file, 'a,b\n1,2');
    removePartialArtifact(file);
    expect(fs.existsSync(file)).toBe(false);
    fs.rmdirSync(dir);
  });
});
