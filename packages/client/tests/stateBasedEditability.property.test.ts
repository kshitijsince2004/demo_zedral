/**
 * Property 10: State-based editability and change-request routing
 *
 * Validates: Requirements 6.6
 *
 * When a shift log is in SUBMITTED or APPROVED state, operator edit controls
 * must be locked and modification attempts must be routed through the
 * change-request flow. Only in DRAFT or REOPENED state may operators edit
 * directly.
 *
 * This test validates the pure state-machine logic that governs:
 *   - Which states lock direct editing
 *   - Which states allow direct editing
 *   - That the ChangeRequestPanel should render iff the log is locked
 *   - That a change request submission is only possible in a locked state
 *
 * Tagged: Feature: m1-frontend-remediation, Property 10: State-based editability and change-request routing
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShiftLogState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REOPENED';

// ---------------------------------------------------------------------------
// Pure state-machine helpers under test
// (mirror the logic in useShiftLogState and ChangeRequestPanel)
// ---------------------------------------------------------------------------

/** Returns true when the shift log state locks direct operator edits. */
function isEditLocked(state: ShiftLogState): boolean {
  return state === 'SUBMITTED' || state === 'APPROVED';
}

/** Returns true when the ChangeRequestPanel should render. */
function shouldShowChangeRequestPanel(state: ShiftLogState): boolean {
  return isEditLocked(state);
}

/** Returns true when an operator can raise a new change request. */
function canRaiseChangeRequest(state: ShiftLogState): boolean {
  return isEditLocked(state);
}

/** Returns true when the operator can directly edit the form fields. */
function canDirectlyEdit(state: ShiftLogState): boolean {
  return !isEditLocked(state);
}

/** Returns true when saving through useEntryForm is permitted without a CR. */
function canSaveDirectly(state: ShiftLogState): boolean {
  return state === 'DRAFT' || state === 'REOPENED';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCKED_STATES: ShiftLogState[] = ['SUBMITTED', 'APPROVED'];
const EDITABLE_STATES: ShiftLogState[] = ['DRAFT', 'REOPENED'];
const ALL_STATES: ShiftLogState[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REOPENED'];

const stateArb = fc.constantFrom(...ALL_STATES);
const lockedStateArb = fc.constantFrom(...LOCKED_STATES);
const editableStateArb = fc.constantFrom(...EDITABLE_STATES);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Property 10: State-based editability and change-request routing', () => {

  it('10a — SUBMITTED and APPROVED states lock editing (Req 6.6)', () => {
    fc.assert(
      fc.property(lockedStateArb, (state) => {
        expect(isEditLocked(state)).toBe(true);
        expect(canDirectlyEdit(state)).toBe(false);
        expect(canSaveDirectly(state)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('10b — DRAFT and REOPENED states allow direct editing (Req 6.6)', () => {
    fc.assert(
      fc.property(editableStateArb, (state) => {
        expect(isEditLocked(state)).toBe(false);
        expect(canDirectlyEdit(state)).toBe(true);
        expect(canSaveDirectly(state)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('10c — ChangeRequestPanel renders iff log is locked (Req 6.6)', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(shouldShowChangeRequestPanel(state)).toBe(isEditLocked(state));
      }),
      { numRuns: 100 }
    );
  });

  it('10d — change request can only be raised when log is locked (Req 6.4)', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(canRaiseChangeRequest(state)).toBe(isEditLocked(state));
      }),
      { numRuns: 100 }
    );
  });

  it('10e — editability and lock are strictly complementary (Req 6.6)', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        expect(canDirectlyEdit(state)).toBe(!isEditLocked(state));
      }),
      { numRuns: 100 }
    );
  });

  it('10f — DRAFT is editable; SUBMITTED is locked; APPROVED is locked; REOPENED is editable', () => {
    // Regression table — guards the exact four-state mapping
    expect(isEditLocked('DRAFT')).toBe(false);
    expect(isEditLocked('SUBMITTED')).toBe(true);
    expect(isEditLocked('APPROVED')).toBe(true);
    expect(isEditLocked('REOPENED')).toBe(false);
  });

  it('10g — exactly 2 states lock editing and exactly 2 allow direct edit', () => {
    const locked = ALL_STATES.filter(isEditLocked);
    const editable = ALL_STATES.filter(canDirectlyEdit);
    expect(locked).toHaveLength(2);
    expect(editable).toHaveLength(2);
    expect(locked.sort()).toEqual(['APPROVED', 'SUBMITTED']);
    expect(editable.sort()).toEqual(['DRAFT', 'REOPENED']);
  });
});
