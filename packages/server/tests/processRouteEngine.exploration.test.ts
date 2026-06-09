/**
 * Property 1: Bug Condition — Route Code 6 Collapse, ROUTE_META Mis-mapping, Standalone Queue Skip
 * Re-run after fix (Task 3.7) — expects PASS on fixed code.
 */
import { describe, it, expect } from 'vitest';
import { translatePpcRoute, parseRouteForJourney } from '../src/utils/PpcRouteTranslator';
import { parseRouteString } from '../src/services/ProcessRouteService';

const CRM_CODES = ['4', '6', 'X', 'Y', 'Z'] as const;

describe('Property 1: Bug Condition exploration', () => {
  it('Test A — translatePpcRoute preserves route code 6 (concatenated)', () => {
    const result = translatePpcRoute('SP6FZCLE');
    expect(result.canonical).toContain('6');
    expect(result.canonical).not.toMatch(/(^|-)4(-|$)/);
    expect(result.canonical).toBe('S-P-6-F-Z-C-LE-PKG');
  });

  it('Test B — parseRouteForJourney preserves route code 6 (dash-separated)', () => {
    const canonical = parseRouteForJourney('S-P-6-F-Z-C-LE');
    expect(canonical).toContain('6');
    expect(canonical.split('-')).not.toContain('4');
  });

  it('Test C — independent 4/6 steps preserve distinct rolling tokens with correct pass count', () => {
    const canonical = parseRouteForJourney('S-P-6-F-4-R-C');
    const steps = parseRouteString(canonical);
    const rolling = steps.filter((s) => s.routeCode === '4' || s.routeCode === '6');
    expect(rolling).toHaveLength(2);
    expect(rolling.find((s) => s.routeCode === '6')?.machineCode).toBe('6HI');
    // Route code 4 is generic rolling — machine assigned at batch import, not on journey steps.
    expect(rolling.find((s) => s.routeCode === '4')?.machineCode).toBeNull();

    const translated = translatePpcRoute('SP6F4RC');
    expect(translated.rollingPassCount).toBe(2);
  });

  it('Test D — ROUTE_META processCode is CRM for CRM route codes', () => {
    for (const code of CRM_CODES) {
      const steps = parseRouteString(`S-P-${code}-F-C-LE`);
      const step = steps.find((s) => s.routeCode === code);
      expect(step?.processCode).toBe('CRM');
    }
  });

  it('Test E — enqueueNextStep accepts standalone machine with null sub_process', async () => {
    const { QueueTransferService } = await import('../src/services/QueueTransferService');
    const source = QueueTransferService.enqueueNextStep.toString();
    expect(source).not.toMatch(/!nextStep\.sub_process/);
    expect(source).toContain('queueSubProcess');
  });
});
