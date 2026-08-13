import { useEffect, useState } from 'react';
import { Thermometer } from 'lucide-react';
import { ZButton } from '../primitives/ZButton';
import { apiClient } from '../../lib/apiClient';
import { ShiftReadingsFields } from './shiftReadingsForm';
import { overlayClass } from '../../lib/nativeOverlay';
import {
  emptyShiftReadings,
  parseOptionalNumber,
  readingsFromSummary,
  type ShiftReadingsValues,
} from './shiftReadingsValues';

/** Modal: operator logs Shift Readings against the current shift-log. */
export function ShiftReadingsModal({
  open,
  shiftLogId,
  onClose,
  onSaved,
}: {
  open: boolean;
  shiftLogId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<ShiftReadingsValues>(emptyShiftReadings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !shiftLogId) return;
    let cancelled = false;
    setError(null);
    void apiClient
      .get<{
        scrapKg?: number | null;
        coolantTempDegC?: number | null;
        coolantPressKgCm2?: number | null;
      }>(`/6hi/shift-summary/${encodeURIComponent(shiftLogId)}`)
      .then((summary) => {
        if (!cancelled) setValues(readingsFromSummary(summary));
      })
      .catch(() => {
        if (!cancelled) setValues(emptyShiftReadings);
      });
    return () => {
      cancelled = true;
    };
  }, [open, shiftLogId]);

  if (!open) return null;

  const save = async () => {
    if (!shiftLogId) {
      setError('No active shift log');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(`/shift-logs/${shiftLogId}/readings`, {
        scrapKg: parseOptionalNumber(values.scrapKg) ?? null,
        coolantTempDegC: parseOptionalNumber(values.coolantTempDegC) ?? null,
        coolantPressKgCm2: parseOptionalNumber(values.coolantPressKgCm2) ?? null,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save readings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={overlayClass('fixed inset-0 z-[110] bg-primary/40', 'backdrop-blur-[1px]')} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Shift readings"
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border border-border bg-white rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-center gap-3 px-5 py-4 bg-primary text-white rounded-t-[14px]">
          <Thermometer className="h-6 w-6" />
          <div>
            <h3 className="text-lg font-bold">Shift Readings</h3>
            <p className="text-sm opacity-90">Coolant + scrap for this shift</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Log readings during the shift so auto-handover can snapshot them if you miss the handover form.
          </p>
          <ShiftReadingsFields values={values} onChange={setValues} disabled={busy} />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-border bg-secondary/30 rounded-b-[14px]">
          <ZButton variant="ghost" onClick={onClose} className="flex-1 min-h-12" disabled={busy}>
            Cancel
          </ZButton>
          <ZButton variant="accent" onClick={() => void save()} className="flex-[2] min-h-12" disabled={busy || !shiftLogId}>
            {busy ? 'Saving…' : 'Save readings'}
          </ZButton>
        </div>
      </div>
    </>
  );
}
