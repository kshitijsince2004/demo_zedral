/**
 * DefectSubForm — inline defect capture slot inside ShiftLogShell.
 *
 * Persists each defect entry through the sync engine associated with the
 * current shift log. Replaces the dead GenericForms.tsx DefectEntryForm.
 *
 * Requirements: 1.2, 5.1, 5.3
 */

import { useState, useEffect } from 'react';
import { syncEngine } from '../../lib/syncEngine';
import { useGloveModeClasses } from '../../hooks/useGloveModeClasses';
import { apiClient } from '../../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MasterDefectCode {
  defect_code: string;
  description: string;
  is_active?: boolean;
}

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

// ─── Hook: Load defect codes from master data ─────────────────────────────────

function useDefectCodes() {
  const [codes, setCodes] = useState<MasterDefectCode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<MasterDefectCode[]>('/master-data/defect_codes')
      .then((data) => { if (!cancelled) setCodes(data); })
      .catch(() => { /* will render empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { codes, loading };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DefectSubForm({ shiftLogId }: DefectSubFormProps) {
  const { inputFieldHeight, saveHeight, controlGap } = useGloveModeClasses();
  const { codes: DEFECT_CODES, loading: codesLoading } = useDefectCodes();

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
    DEFECT_CODES.find((d) => d.defect_code === code)?.description ?? code;

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
            <option value="">{codesLoading ? 'Loading…' : 'Select Defect Code…'}</option>
            {DEFECT_CODES.map((d) => (
              <option key={d.defect_code} value={d.defect_code}>
                {d.defect_code} — {d.description}
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
