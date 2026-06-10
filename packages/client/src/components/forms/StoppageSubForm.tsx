/**
 * StoppageSubForm — inline stoppage capture slot inside ShiftLogShell.
 *
 * Persists each stoppage through the sync engine associated with the current
 * shift log. Replaces the dead GenericForms.tsx StoppageEntryForm prototype.
 *
 * Requirements: 1.2, 5.1, 5.3
 */

import { useState, useEffect } from 'react';
import { syncEngine } from '../../lib/syncEngine';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';
import { apiClient } from '../../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MasterStoppageCode {
  stoppage_code: string;
  description: string;
  category: string;
  is_active?: boolean;
}

export interface StoppageSubFormProps {
  /** The shift log ID this stoppage is associated with. */
  shiftLogId: string;
}

type SaveState = 'idle' | 'saving' | 'queued' | 'transmitted' | 'failed';

// ─── Hook: Load stoppage codes from master data ───────────────────────────────

function useStoppageCodes() {
  const [codes, setCodes] = useState<MasterStoppageCode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<MasterStoppageCode[]>('/master-data/stoppage_codes')
      .then((data) => { if (!cancelled) setCodes(data); })
      .catch(() => { /* will render empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { codes, loading };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StoppageSubForm({ shiftLogId }: StoppageSubFormProps) {
  const { inputFieldHeight, saveHeight, controlGap } = useGloveModeClasses();
  const { codes: STOPPAGE_CODES, loading: codesLoading } = useStoppageCodes();

  const [selectedCode, setSelectedCode] = useState('');
  const [fromTime, setFromTime] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
  });
  const [toTime, setToTime] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = STOPPAGE_CODES.find((s) => s.stoppage_code === selectedCode);

  const handleSave = async () => {
    if (!selectedCode) {
      setError('Select a stoppage code before saving.');
      return;
    }
    setError(null);
    setSaveState('saving');

    const payload = {
      shiftLogId,
      stoppageCode: selectedCode,
      fromTime,
      toTime: toTime || null,
      durationMins: toTime ? calculateDuration(fromTime, toTime) : null,
      remarks: remarks.trim() || null,
    };

    try {
      await syncEngine.enqueue('/stoppages', 'POST', payload);
      const pending = await syncEngine.getPendingCount();
      setSaveState(pending === 0 ? 'transmitted' : 'queued');
      // Reset form after successful save
      setSelectedCode('');
      setToTime('');
      setRemarks('');
    } catch {
      setSaveState('failed');
      setError('Failed to save stoppage. Please try again.');
    }
  };

  const statusLabel: Record<SaveState, string | null> = {
    idle: null,
    saving: null,
    queued: '✓ Stoppage queued',
    transmitted: '✓ Stoppage saved',
    failed: null,
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
          Log Stoppage
        </span>
        {statusLabel[saveState] && (
          <span className="text-xs font-medium text-success">{statusLabel[saveState]}</span>
        )}
      </div>

      <div className={`p-5 flex flex-col ${controlGap}`}>
        {/* Stoppage code selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Stoppage Code
          </label>
          <select
            value={selectedCode}
            onChange={(e) => {
              setSelectedCode(e.target.value);
              setError(null);
              setSaveState('idle');
            }}
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-full`}
          >
            <option value="">{codesLoading ? 'Loading…' : 'Select Stoppage Code…'}</option>
            {STOPPAGE_CODES.map((s) => (
              <option key={s.stoppage_code} value={s.stoppage_code}>
                {s.stoppage_code} — {s.description}
              </option>
            ))}
          </select>
        </div>

        {/* Selected code confirmation */}
        {selectedEntry && (
          <div className="px-3 py-2 rounded-md bg-warning/15 border border-warning/40">
            <span className="font-mono text-xs text-warning">{selectedEntry.stoppage_code}</span>
            <span className="text-sm font-medium text-warning ml-2">{selectedEntry.description}</span>
          </div>
        )}

        {/* Time range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              From
            </label>
            <input
              type="time"
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
              className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              To (blank = running)
            </label>
            <input
              type="time"
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
              className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
            />
          </div>
        </div>

        {/* Duration display */}
        {toTime && fromTime && (
          <div className="px-3 py-2 rounded-md bg-secondary text-center">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration: </span>
            <span className="font-mono text-sm font-bold">
              {calculateDuration(fromTime, toTime)} min
            </span>
          </div>
        )}

        {/* Remarks */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Remarks (optional)
          </label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Free text…"
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs font-medium text-destructive flex items-center gap-1">
            ⚠ {error}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saveState === 'saving' || !selectedCode}
          className={`${saveHeight} rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {saveState === 'saving' ? '…Saving' : '✓ Save Stoppage'}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateDuration(from: string, to: string): number {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let diff = th * 60 + tm - (fh * 60 + fm);
  if (diff < 0) diff += 24 * 60; // overnight
  return diff;
}
