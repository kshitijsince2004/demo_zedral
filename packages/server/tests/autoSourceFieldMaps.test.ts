import { describe, it, expect } from 'vitest';
import { buildAutoSourceFields } from '../src/services/autoSourceFieldMaps';
import { AutoSourceContext } from '../src/services/autoSourceContext';
import { getPreviousProcessCode } from '../src/services/autoSourceContext';

function baseContext(overrides: Partial<AutoSourceContext> = {}): AutoSourceContext {
  return {
    processCode: 'CRM',
    coilNo: 'C-1001',
    coil: null,
    plan: null,
    gradeSpec: null,
    previousProcess: null,
    ...overrides,
  };
}

describe('getPreviousProcessCode', () => {
  it('returns PKL before CRM', () => {
    expect(getPreviousProcessCode('CRM')).toBe('PKL');
  });

  it('returns null for first process', () => {
    expect(getPreviousProcessCode('HRS')).toBeNull();
  });
});

describe('buildAutoSourceFields', () => {
  it('CRM: prefers planning target thickness over manual entry', () => {
    const fields = buildAutoSourceFields(
      baseContext({
        plan: {
          sapOrderNo: 'PP-1',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          targetWidthMm: 1250,
          targetThkMm: 0.45,
          plannedQtyMt: 12.5,
          plannedProcessCode: 'CRM',
        },
        coil: {
          coilNo: 'C-1001',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          heatNo: null,
          nominalWidthMm: 1240,
          coilWidthMm: 1245,
          coilThkMm: 0.5,
          weightMt: 12.2,
        },
        previousProcess: {
          processCode: 'PKL',
          inThkMm: 0.52,
          outThkMm: 0.5,
          outWeightMt: 12.2,
        },
      }),
    );

    expect(fields.widthMm).toEqual({ value: 1250, source: 'PLANNING', isEditable: false });
    expect(fields.inputThkMm).toEqual({ value: 0.5, source: 'COIL_MASTER', isEditable: false });
    expect(fields.outputThkMm).toEqual({ value: 0.45, source: 'PLANNING', isEditable: true });
    expect(fields.weightMt).toEqual({ value: 12.2, source: 'COIL_MASTER', isEditable: true });
  });

  it('CRM: uses previous-process output thickness when coil thickness absent', () => {
    const fields = buildAutoSourceFields(
      baseContext({
        previousProcess: {
          processCode: 'PKL',
          inThkMm: 0.52,
          outThkMm: 0.48,
          outWeightMt: 11.8,
        },
      }),
    );

    expect(fields.inputThkMm).toEqual({
      value: 0.48,
      source: 'PREVIOUS_PROCESS',
      isEditable: false,
    });
    expect(fields.weightMt).toEqual({
      value: 11.8,
      source: 'PREVIOUS_PROCESS',
      isEditable: true,
    });
  });

  it('PKL: sources heat number from coil master', () => {
    const fields = buildAutoSourceFields(
      baseContext({
        processCode: 'PKL',
        coil: {
          coilNo: 'C-1001',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          heatNo: 'HT-99',
          nominalWidthMm: 1200,
          coilWidthMm: 1205,
          coilThkMm: 2.0,
          weightMt: 18,
        },
        plan: {
          sapOrderNo: 'PP-77',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          targetWidthMm: 1200,
          targetThkMm: 1.8,
          plannedQtyMt: 18,
          plannedProcessCode: 'PKL',
        },
      }),
    );

    expect(fields.heatNo).toEqual({ value: 'HT-99', source: 'COIL_MASTER', isEditable: false });
    expect(fields.source).toEqual({ value: 'PP-77', source: 'PLANNING', isEditable: false });
    expect(fields.thkMm.source).toBe('COIL_MASTER');
  });

  it('HRS: maps planning width and coil weight', () => {
    const fields = buildAutoSourceFields(
      baseContext({
        processCode: 'HRS',
        plan: {
          sapOrderNo: null,
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          targetWidthMm: 1500,
          targetThkMm: 2.5,
          plannedQtyMt: 20,
          plannedProcessCode: 'HRS',
        },
        coil: {
          coilNo: 'C-2000',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          heatNo: null,
          nominalWidthMm: 1490,
          coilWidthMm: null,
          coilThkMm: 2.4,
          weightMt: 19.5,
        },
      }),
    );

    expect(fields.nominalWidthMm).toEqual({ value: 1500, source: 'PLANNING', isEditable: true });
    expect(fields.nominalThkMm).toEqual({ value: 2.5, source: 'PLANNING', isEditable: true });
    expect(fields.weightMt).toEqual({ value: 20, source: 'PLANNING', isEditable: true });
  });

  it('CRS: maps coil width and grade-spec hardness midpoint', () => {
    const fields = buildAutoSourceFields(
      baseContext({
        processCode: 'CRS',
        coil: {
          coilNo: 'C-1001',
          gradeCode: 'CRCA',
          customerId: 1,
          surfaceFinish: null,
          heatNo: null,
          nominalWidthMm: 1100,
          coilWidthMm: 1102,
          coilThkMm: 0.35,
          weightMt: 8.5,
        },
        gradeSpec: {
          hardnessHrbMin: 60,
          hardnessHrbMax: 70,
          utsNmm2Min: null,
          utsNmm2Max: null,
          elongationPctMin: null,
          raUmMax: 1.2,
        },
      }),
    );

    expect(fields.coilWidthMm.value).toBe(1102);
    expect(fields.hardnessHrb).toEqual({ value: 65, source: 'GRADE_SPEC', isEditable: true });
    expect(fields.raUm).toEqual({ value: 1.2, source: 'GRADE_SPEC', isEditable: true });
  });

  it('omits fields with no resolvable value', () => {
    const fields = buildAutoSourceFields(baseContext({ processCode: 'PKL' }));
    expect(fields).toEqual({});
  });
});
