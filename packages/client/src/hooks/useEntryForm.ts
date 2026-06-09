/**
 * useEntryForm — shared save path for all process entry forms.
 *
 * Implements the validate → enqueue → status flow described in the design
 * (Persistence Flow, Requirement 2):
 *
 *   1. Validate the payload via `@m1/shared-validation` `validateProcessEntry`.
 *   2. On success, enqueue through `syncEngine` into `offlineStore`.
 *   3. Derive `saveStatus` from the engine's actual outcome
 *      (`queued` while offline/pending, `transmitted` once synced).
 *   4. Clear dirty state after a successful save.
 *   5. Block invalid saves with field-level errors; leave the queue unchanged.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { useState, useCallback, useRef } from 'react';
import { validateProcessEntry } from '@m1/shared-validation';
import type { ValidationError, ValidationWarning } from '@m1/shared-validation';
import { syncEngine } from '../lib/syncEngine';
import type { SyncQueueItem } from '../lib/offlineStore';

// ─── Public types ─────────────────────────────────────────────────────────────

export type SaveStatus = 'idle' | 'queued' | 'transmitted' | 'failed';

export interface SaveOutcome {
  outcome: 'blocked' | 'queued' | 'transmitted';
  /** Populated when outcome === 'blocked'. */
  errors: ValidationError[];
  warnings?: ValidationWarning[];
  /** offlineStore item id when outcome === 'queued' or 'transmitted'. */
  queueId?: string;
}

export interface UseEntryFormOptions<TPayload extends Record<string, unknown>> {
  /** Canonical process code, e.g. 'HRS', 'PKL', 'CRM'. */
  processCode: string;
  /** Initial field values. */
  initialValues: TPayload;
}

export interface UseEntryFormReturn<TPayload extends Record<string, unknown>> {
  values: TPayload;
  setValue: (field: keyof TPayload, value: unknown) => void;
  isDirty: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  saveStatus: SaveStatus;
  /**
   * Validates via shared library, then enqueues through syncEngine.
   * Returns a SaveOutcome describing what happened.
   */
  save: () => Promise<SaveOutcome>;
  /** Reset form to initial values and clear all state. */
  reset: () => void;
}

// ─── Core save logic (pure, injectable — enables unit testing) ────────────────

export interface SaveDependencies {
  validate: typeof validateProcessEntry;
  enqueue: typeof syncEngine.enqueue;
  getPendingCount: typeof syncEngine.getPendingCount;
}

/**
 * Core save logic extracted from the hook so it can be unit-tested without
 * React or a DOM environment.
 *
 * Returns the SaveOutcome and the derived SaveStatus so the hook can apply
 * them to React state.
 */
export async function executeSave(
  processCode: string,
  payload: Record<string, unknown>,
  deps: SaveDependencies,
  effectiveRuleset?: EffectiveRuleset,
): Promise<{ outcome: SaveOutcome; status: SaveStatus }> {
  // ── Step 1: Validate ────────────────────────────────────────────────────────
  const validationResult = deps.validate(processCode, payload, effectiveRuleset);

  if (!validationResult.isValid) {
    // Block the save; surface field-level errors; leave the queue unchanged.
    return {
      outcome: {
        outcome: 'blocked',
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      },
      status: 'idle',
    };
  }

  // ── Step 2: Enqueue through the sync engine ─────────────────────────────────
  const endpoint = `/entries/${processCode.toLowerCase()}`;
  const syncPayload = { 
    ...payload, 
    processCode: processCode.toUpperCase(),
    ...(effectiveRuleset ? { rulesetVersion: effectiveRuleset.version } : {})
  };

  let queuedItem: SyncQueueItem;
  try {
    queuedItem = await deps.enqueue(endpoint, 'POST', syncPayload);
  } catch (err) {
    return {
      outcome: {
        outcome: 'blocked',
        errors: [
          {
            field: '_form',
            message: err instanceof Error ? err.message : 'Failed to enqueue entry',
            severity: 'BLOCK',
          },
        ],
      },
      status: 'failed',
    };
  }

  // ── Step 3: Derive save status from the engine's actual outcome ─────────────
  // After enqueue, check whether the item was immediately transmitted (synced)
  // or is still pending in the offline store.
  const pendingCount = await deps.getPendingCount();
  const isTransmitted = pendingCount === 0;
  const derivedStatus: SaveStatus = isTransmitted ? 'transmitted' : 'queued';

  return {
    outcome: {
      outcome: derivedStatus,
      errors: [],
      queueId: queuedItem.id,
    },
    status: derivedStatus,
  };
}

// ─── Hook implementation ──────────────────────────────────────────────────────

import { useEffectiveRuleset } from './useEffectiveRuleset';
import type { EffectiveRuleset } from '@m1/shared-validation';

export function useEntryForm<TPayload extends Record<string, unknown>>(
  options: UseEntryFormOptions<TPayload>,
): UseEntryFormReturn<TPayload> {
  const { processCode, initialValues } = options;

  const [values, setValues] = useState<TPayload>(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const { effectiveRuleset } = useEffectiveRuleset();

  // Keep a stable ref to the latest values so the save callback doesn't
  // close over a stale snapshot.
  const valuesRef = useRef<TPayload>(values);
  valuesRef.current = values;

  const setValue = useCallback(
    (field: keyof TPayload, value: unknown) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      setIsDirty(true);
      // Clear any existing error for this field so the UI updates immediately.
      setErrors((prev) => prev.filter((e) => e.field !== String(field)));
    },
    [],
  );

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const payload = valuesRef.current as Record<string, unknown>;

    const { outcome, status } = await executeSave(processCode, payload, {
      validate: validateProcessEntry,
      enqueue: syncEngine.enqueue.bind(syncEngine),
      getPendingCount: syncEngine.getPendingCount.bind(syncEngine),
    }, effectiveRuleset || undefined);

    setSaveStatus(status);

    if (outcome.outcome !== 'blocked') {
      // Clear dirty state and any stale validation errors on success.
      setIsDirty(false);
      setErrors([]);
      setWarnings([]);
    } else {
      // Surface field-level errors and warnings.
      setErrors(outcome.errors);
      setWarnings(outcome.warnings || []);
    }

    return outcome;
  }, [processCode, effectiveRuleset]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setIsDirty(false);
    setErrors([]);
    setWarnings([]);
    setSaveStatus('idle');
  }, [initialValues]);

  return {
    values,
    setValue,
    isDirty,
    errors,
    warnings,
    saveStatus,
    save,
    reset,
  };
}
