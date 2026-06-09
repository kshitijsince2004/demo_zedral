/**
 * DefectSubForm — inline defect capture slot inside ShiftLogShell.
 *
 * Persists each defect entry through the sync engine associated with the
 * current shift log. Replaces the dead GenericForms.tsx DefectEntryForm.
 *
 * Requirements: 1.2, 5.1, 5.3
 */

import { useState } from 'react';
import { syncEngine } from '../../lib/syncEngine';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';

// ─── Defect codes (will be sourced from master data in task 12.1) ─────────────

const DEFECT_CODES = [
  { code: 'SCR-01', description: 'Scratch' },
  { code: 'RST-01', description: 'Rust' },
  { code: 'DEN-01', description: 'Dent' },
  { code: 'EDG-01', description: 'Edge Crack' },
  { code: 'SLT-01', description: 'Slit Burr' },
  { code: 'OIL-01', description: 'Oil Stain' },
  { code: 'WAV-01', description: 'Waviness' },
  { code: 'CAM-01', description: 'Camber' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DefectSubFormProps {
  /** The shift log ID this defect is associated with. */
  shiftLogId: string;
}

interface DefectEntry {
  id: string;
  defectCode: string;
  location: string;
  quantityMt: number;
}

type SaveState = 'idle' | 'saving' | 'queued' | 'transmitted' | 'failed';

// ─── Component ────────────────────────────────────────────────────────────────

export function DefectSubForm({ shiftLogId }: DefectSubFormProps) {
  const { inputFieldHeight, saveHeight, controlGap } = useGloveModeClasses();

  const [defectCode, setDefectCode] = useState('');
  const [location, setLocation] = useState('');
  const [quantityMt, setQuantityMt] = useState('');
  const [defectList, setDefectList] = useState<DefectEntry[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!defectCode) {
      setError('Select a defect code before saving.');
      return;
    }
    const qty = parseFloat(quantityMt);
    if (isNaN(qty) || qty < 0) {
      setError('Enter a valid quantity (MT ≥ 0).');
      return;
    }
    setError(null);
    setSaveState('saving');

    const payload = {
      shiftLogId,
      defectCode,
      location: location.trim() || null,
      quantityMt: qty,
    };

    try {
      await syncEngine.enqueue('/defects', 'POST', payload);
      const pending = await syncEngine.getPendingCount();
      setSaveState(pending === 0 ? 'transmitted' : 'queued');

      // Add to local list for display
      setDefectList((prev) => [
        ...prev,
        {
          id: `defect-${Date.now()}`,
          defectCode,
          location: location.trim(),
          quantityMt: qty,
        },
      ]);

      // Reset fields
      setDefectCode('');
      setLocation('');
      setQuantityMt('');
    } catch {
      setSaveState('failed');
      setError('Failed to save defect. Please try again.');
    }
  };

  const descriptionFor = (code: string) =>
    DEFECT_CODES.find((d) => d.code === code)?.description ?? code;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
          Log Defect
        </span>
        {defectList.length > 0 && (
          <span className="text-xs font-medium text-muted-foreground">
            {defectList.length} defect{defectList.length !== 1 ? 's' : ''} logged
          </span>
        )}
      </div>

      <div className={`p-5 flex flex-col ${controlGap}`}>
        {/* Defect list */}
        {defectList.length > 0 && (
          <div className="flex flex-col gap-2">
            {defectList.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary border border-border"
              >
                <div className="flex flex-col">
                  <span className="text-xs font-medium">
                    {descriptionFor(entry.defectCode)}
                  </span>
                  {entry.location && (
                    <span className="text-[10px] text-muted-foreground">
                      {entry.location}
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs font-semibold text-destructive">
                  {entry.quantityMt} MT
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Defect code selector */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Defect Code
          </label>
          <select
            value={defectCode}
            onChange={(e) => {
              setDefectCode(e.target.value);
              setError(null);
              setSaveState('idle');
            }}
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-full`}
          >
            <option value="">Select Defect Code…</option>
            {DEFECT_CODES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — {d.description}
              </option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Location (optional)
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Edge, Center, Top"
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          />
        </div>

        {/* Quantity */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Quantity (MT)
          </label>
          <input
            type="number"
            value={quantityMt}
            onChange={(e) => {
              setQuantityMt(e.target.value);
              setError(null);
              setSaveState('idle');
            }}
            placeholder="0.000"
            min="0"
            step="0.001"
            className={`${inputFieldHeight} rounded-md border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs font-medium text-destructive flex items-center gap-1">
            ⚠ {error}
          </div>
        )}

        {/* Save status */}
        {(saveState === 'queued' || saveState === 'transmitted') && (
          <div className="text-xs font-medium text-success flex items-center gap-1">
            ✓ {saveState === 'transmitted' ? 'Defect saved' : 'Defect queued'}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saveState === 'saving' || !defectCode}
          className={`${saveHeight} rounded-md border border-destructive/40 text-destructive text-sm font-semibold hover:bg-destructive/10 transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {saveState === 'saving' ? '…Saving' : '⚠ Log Defect'}
        </button>
      </div>
    </div>
  );
}
