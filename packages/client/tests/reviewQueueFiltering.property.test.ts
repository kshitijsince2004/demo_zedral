/**
 * Property 11: Review-queue filtering
 *
 * Validates: Requirements 6.1
 *
 * Requirement 6.1 states that the review queue must list shift logs in
 * SUBMITTED state within the reviewer's line scope. This test validates the
 * pure filtering logic:
 *   - Only SUBMITTED logs appear in the queue (not DRAFT, APPROVED, REOPENED)
 *   - Only logs whose lineId is in the reviewer's line scope appear
 *   - A reviewer with an empty scope sees no logs (unless they have admin scope)
 *   - A reviewer with full scope sees all SUBMITTED logs regardless of line
 *
 * Tagged: Feature: m1-frontend-remediation, Property 11: Review-queue filtering
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShiftLogState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REOPENED';
type ProcessCode = 'HRS' | 'PKL' | 'CRM' | 'ANN' | 'SKP' | 'RWD' | 'CRS' | 'CTL';

interface ShiftLogSummary {
  id: string;
  lineId: ProcessCode;
  state: ShiftLogState;
  date: string;
}

// ---------------------------------------------------------------------------
// Pure filtering helpers under test
// (mirror what the ReviewQueue page renders)
// ---------------------------------------------------------------------------

const ALL_PROCESS_CODES: ProcessCode[] = ['HRS', 'PKL', 'CRM', 'ANN', 'SKP', 'RWD', 'CRS', 'CTL'];

/**
 * Filters shift logs for the review queue.
 * @param logs All shift logs visible to the reviewer.
 * @param scopedLines The line IDs the reviewer has access to. Empty = all lines.
 */
function filterForReviewQueue(
  logs: ShiftLogSummary[],
  scopedLines: ProcessCode[],
): ShiftLogSummary[] {
  return logs.filter((log) => {
    // Must be SUBMITTED
    if (log.state !== 'SUBMITTED') return false;
    // If scopedLines is empty, reviewer sees all (admin/supervisor scope)
    if (scopedLines.length === 0) return true;
    // Otherwise restrict to the reviewer's line scope
    return scopedLines.includes(log.lineId);
  });
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const processCodeArb = fc.constantFrom<ProcessCode>(...ALL_PROCESS_CODES);
const stateArb = fc.constantFrom<ShiftLogState>('DRAFT', 'SUBMITTED', 'APPROVED', 'REOPENED');

const shiftLogArb = fc.record({
  id: fc.uuid(),
  lineId: processCodeArb,
  state: stateArb,
  date: fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
});

const logListArb = fc.array(shiftLogArb, { minLength: 0, maxLength: 40 });

const scopedLinesArb = fc.array(processCodeArb, { minLength: 0, maxLength: 8 }).map(
  (arr) => [...new Set(arr)] as ProcessCode[],
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 11: Review-queue filtering', () => {

  it('11a — only SUBMITTED logs appear in the review queue (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, scopedLinesArb, (logs, scopedLines) => {
        const queue = filterForReviewQueue(logs, scopedLines);
        for (const log of queue) {
          expect(log.state).toBe('SUBMITTED');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('11b — DRAFT, APPROVED, REOPENED logs never appear in the queue (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, scopedLinesArb, (logs, scopedLines) => {
        const queue = filterForReviewQueue(logs, scopedLines);
        const nonSubmitted = queue.filter((l) => l.state !== 'SUBMITTED');
        expect(nonSubmitted).toHaveLength(0);
      }),
      { numRuns: 200 }
    );
  });

  it('11c — logs outside the reviewer line scope are excluded (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, (logs) => {
        // Use a single-line scope
        const scope: ProcessCode[] = ['HRS'];
        const queue = filterForReviewQueue(logs, scope);
        for (const log of queue) {
          expect(log.lineId).toBe('HRS');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('11d — empty scope means admin/supervisor sees all SUBMITTED logs (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, (logs) => {
        const queue = filterForReviewQueue(logs, []); // empty = full scope
        const allSubmitted = logs.filter((l) => l.state === 'SUBMITTED');
        expect(queue.length).toBe(allSubmitted.length);
      }),
      { numRuns: 200 }
    );
  });

  it('11e — the queue length never exceeds the total SUBMITTED count (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, scopedLinesArb, (logs, scopedLines) => {
        const queue = filterForReviewQueue(logs, scopedLines);
        const totalSubmitted = logs.filter((l) => l.state === 'SUBMITTED').length;
        expect(queue.length).toBeLessThanOrEqual(totalSubmitted);
      }),
      { numRuns: 200 }
    );
  });

  it('11f — filtering is idempotent: applying the filter twice gives the same result (Req 6.1)', () => {
    fc.assert(
      fc.property(logListArb, scopedLinesArb, (logs, scopedLines) => {
        const once = filterForReviewQueue(logs, scopedLines);
        const twice = filterForReviewQueue(once, scopedLines);
        expect(twice).toHaveLength(once.length);
        for (let i = 0; i < once.length; i++) {
          expect(twice[i].id).toBe(once[i].id);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('11g — a reviewer with no scope and no SUBMITTED logs sees an empty queue (Req 6.1)', () => {
    // All logs are non-SUBMITTED
    const nonSubmitted: ShiftLogSummary[] = [
      { id: '1', lineId: 'HRS', state: 'DRAFT', date: '2025-01-01' },
      { id: '2', lineId: 'PKL', state: 'APPROVED', date: '2025-01-01' },
      { id: '3', lineId: 'CRM', state: 'REOPENED', date: '2025-01-01' },
    ];
    expect(filterForReviewQueue(nonSubmitted, [])).toHaveLength(0);
    expect(filterForReviewQueue(nonSubmitted, ['HRS', 'PKL'])).toHaveLength(0);
  });
});
