/**
 * useShiftLogState — derives the current shift log state from the API.
 *
 * Used by ShiftLogShell to determine:
 *   - Whether operator edit controls should be locked (SUBMITTED/APPROVED)
 *   - Whether the ChangeRequestPanel should be rendered
 *   - The state label to display in the header
 *
 * Requirements: 6.6
 */

import { useState, useEffect } from 'react';
import { apiClient } from '../lib/apiClient';

export type ShiftLogState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REOPENED';

export interface ShiftLogStateResult {
  state: ShiftLogState;
  /** True when the operator cannot directly edit (SUBMITTED or APPROVED). */
  isLocked: boolean;
  loading: boolean;
  error: string | null;
}

export function useShiftLogState(shiftLogId: string): ShiftLogStateResult {
  const [state, setState] = useState<ShiftLogState>('DRAFT');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftLogId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<{ state: ShiftLogState }>(`/shift-logs/${shiftLogId}/state`)
      .then((res) => {
        if (!cancelled) setState(res.state);
      })
      .catch((err) => {
        if (!cancelled) {
          // On error (e.g. 404 for a brand new draft) default to DRAFT
          if (err?.status === 404) {
            setState('DRAFT');
          } else {
            setError(err?.message ?? 'Unable to fetch shift log state');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [shiftLogId]);

  return {
    state,
    isLocked: state === 'SUBMITTED' || state === 'APPROVED',
    loading,
    error,
  };
}
