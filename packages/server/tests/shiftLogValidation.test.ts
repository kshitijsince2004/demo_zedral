import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateShiftLogSubmission, ShiftLogState } from '@m1/shared-validation';
import {
  ShiftLogValidationGateError,
  ShiftLogValidationService,
  isValidationStrict,
} from '../src/services/shiftLogValidationService';
import { mapHrsEntry, mapPklEntry } from '../src/services/shiftLogEntryMapper';

describe('shiftLogEntryMapper', () => {
  it('maps HRS DB row to validation payload', () => {
    const entry = mapHrsEntry(
      {
        entry_id: 42,
        coil_no: 'COIL-001',
        sl_no: 1,
        nominal_width_mm: 1250,
        actual_width_mm: 1248,
        nominal_thk_mm: 2.0,
        weight_mt: 25,
        scrap_mt: 0.5,
        time_from: '08:00',
        time_to: '09:30',
      },
      'shift-1',
      [{ slot: 'A', width_mm: 600, thk_mm: 2.0, child_coil_no: 'COIL-001-A' }]
    );

    expect(entry.coilNo).toBe('COIL-001');
    expect(entry.slitSlots).toHaveLength(1);
    expect(entry.slitSlots[0].label).toBe('A');
  });

  it('maps PKL DB row to validation payload', () => {
    const entry = mapPklEntry(
      {
        entry_id: 7,
        coil_no: 'COIL-002',
        width_mm: 1200,
        thk_mm: 1.8,
        weight_mt: 22,
        line_speed_mpm: 180,
        heat_no: 'H123',
        source: 'CRM',
        time_from: '10:00',
        time_to: '11:00',
      },
      'shift-2'
    );

    expect(entry.heatNo).toBe('H123');
    expect(entry.lineSpeedMpm).toBe(180);
  });
});

describe('validateShiftLogSubmission integration', () => {
  it('passes for valid shift log metadata and entries', () => {
    const shiftLog = {
      id: '1',
      processLine: 'PKL',
      productionDate: new Date('2025-06-01'),
      shiftCode: 'A',
      state: ShiftLogState.DRAFT,
      supervisorId: '10',
    };

    const entries = [
      mapPklEntry(
        {
          entry_id: 1,
          coil_no: 'COIL-100',
          width_mm: 1200,
          thk_mm: 1.8,
          weight_mt: 22,
          line_speed_mpm: 180,
          heat_no: 'H1',
          source: 'CRM',
          time_from: '08:00',
          time_to: '09:00',
        },
        '1'
      ),
    ];

    const result = validateShiftLogSubmission(shiftLog, entries);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when CRM shift log is missing mill_type', () => {
    const shiftLog = {
      id: '2',
      processLine: 'CRM',
      productionDate: new Date('2025-06-01'),
      shiftCode: 'B',
      state: ShiftLogState.DRAFT,
      supervisorId: '10',
    };

    const result = validateShiftLogSubmission(shiftLog, []);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('millType'))).toBe(true);
  });

  it('fails when entry has blocking validation errors', () => {
    const shiftLog = {
      id: '3',
      processLine: 'HRS',
      productionDate: new Date('2025-06-01'),
      shiftCode: 'A',
      state: ShiftLogState.DRAFT,
      supervisorId: '10',
    };

    const entries = [
      mapHrsEntry(
        {
          entry_id: 1,
          coil_no: 'COIL-BAD',
          nominal_width_mm: 1250,
          actual_width_mm: 1300,
          nominal_thk_mm: 2.0,
          weight_mt: 25,
          scrap_mt: 0,
          time_from: '08:00',
          time_to: '09:00',
        },
        '3',
        []
      ),
    ];

    const result = validateShiftLogSubmission(shiftLog, entries);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('ShiftLogValidationGateError', () => {
  it('carries validationResult for API responses', () => {
    const validationResult = {
      isValid: false,
      errors: [{ field: 'entries[0].weightMt', message: 'Required', severity: 'BLOCK' as const }],
      warnings: [],
    };

    const err = new ShiftLogValidationGateError(validationResult);
    expect(err.name).toBe('ShiftLogValidationGateError');
    expect(err.validationResult.errors).toHaveLength(1);
  });
});

describe('isValidationStrict', () => {
  const original = process.env.VALIDATION_STRICT;

  afterEach(() => {
    if (original === undefined) delete process.env.VALIDATION_STRICT;
    else process.env.VALIDATION_STRICT = original;
  });

  it('defaults to strict when env is unset', () => {
    delete process.env.VALIDATION_STRICT;
    expect(isValidationStrict()).toBe(true);
  });

  it('allows soft mode when VALIDATION_STRICT=false', () => {
    process.env.VALIDATION_STRICT = 'false';
    expect(isValidationStrict()).toBe(false);
  });
});

describe('ShiftLogValidationService.assertValid', () => {
  beforeEach(() => {
    vi.spyOn(ShiftLogValidationService, 'validate').mockResolvedValue({
      isValid: false,
      errors: [{ field: 'entries[0].coilNo', message: 'Missing', severity: 'BLOCK' }],
      warnings: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ShiftLogValidationGateError when validation fails', async () => {
    await expect(ShiftLogValidationService.assertValid('shift-99')).rejects.toBeInstanceOf(
      ShiftLogValidationGateError
    );
  });

  it('skips gate when VALIDATION_STRICT=false', async () => {
    process.env.VALIDATION_STRICT = 'false';
    await expect(ShiftLogValidationService.assertValid('shift-99')).resolves.toMatchObject({
      isValid: true,
    });
    delete process.env.VALIDATION_STRICT;
  });
});

describe('ShiftLogValidationService.validate (Non-retroactivity)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses bound ruleset_version for existing SUBMITTED logs', async () => {
    const { ShiftLogService } = await import('../src/services/shiftLogService');
    const { ValidationConfigService } = await import('../src/services/ValidationConfigService');

    vi.spyOn(ShiftLogService, 'getById').mockResolvedValue({
      shift_log_id: '1',
      process_id: 2, // PKL
      prod_date: new Date(),
      shift_code: 'A',
      state: ShiftLogState.SUBMITTED,
      ruleset_version: 1, // Log was submitted when version was 1
    } as any);

    vi.spyOn(ShiftLogService, 'getProcessTable').mockReturnValue('txn.prod_pkl');
    vi.spyOn(ShiftLogValidationService, 'loadEntries').mockResolvedValue([]);

    const getConfiguredRulesMock = vi.fn().mockResolvedValue([]);
    const getVersionMock = vi.fn().mockResolvedValue(5); // Current version is 5

    vi.spyOn(ValidationConfigService.prototype, 'getConfiguredRules').mockImplementation(getConfiguredRulesMock);
    vi.spyOn(ValidationConfigService.prototype, 'getVersion').mockImplementation(getVersionMock);

    const result = await ShiftLogValidationService.validate('1');
    
    // We expect the result to have versionSkew because bound version (1) != current (5)
    expect((result as any).versionSkew).toBe(true);
    // And it should have fetched rules, but evaluated against version 1.
    // We can't directly inspect computeEffectiveRuleset without mocking it, 
    // but we can ensure versionSkew is correct.
  });
});
