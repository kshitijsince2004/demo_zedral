import { useEffect, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { useSixHiStoppageCodes, findStoppageCodeDef } from './SixHiStoppageCodes';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import type { SixHiOrderStoppage } from '@m1/shared-validation';

export interface RollChangePayload {
  rollPosition: 'IN' | 'OUT';
  newRollNo: string;
  newRollCode?: string;
  reasonText?: string;
}

interface OrderStoppageModalProps {
  open: boolean;
  hasActiveStoppage: boolean;
  activeStoppage?: SixHiOrderStoppage;
  onClose: () => void;
  onStart?: (categoryCode: string, breakdownCode: string | undefined, remarks?: string) => Promise<void>;
  onUpdate: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onEnd: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onRollChange?: (data: RollChangePayload) => Promise<void>;
}

export function OrderStoppageModal({
  open,
  hasActiveStoppage,
  activeStoppage,
  onClose,
  onStart,
  onUpdate,
  onEnd,
  onRollChange,
}: OrderStoppageModalProps) {
  const { codes: SixHi_STOPPAGE_CODES } = useSixHiStoppageCodes();
  const [displayCode, setDisplayCode] = useState('12');
  const [remarks, setRemarks] = useState('');
  const [rollPosition, setRollPosition] = useState<'IN' | 'OUT'>('OUT');
  const [rollNo, setRollNo] = useState('');
  const [rollCode, setRollCode] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = findStoppageCodeDef(displayCode);
  const needsRollChange = !!selected?.requiresRollChange;
  const { formatted: stoppageTimer } = useLiveTimer(activeStoppage?.startAt, hasActiveStoppage);

  useEffect(() => {
    if (!open) return;
    if (activeStoppage) {
      setDisplayCode(activeStoppage.categoryCode || '12');
      setRemarks(activeStoppage.remarks || '');
    } else {
      setDisplayCode('12');
      setRemarks('');
      setRollNo('');
      setRollCode('');
    }
  }, [open, activeStoppage]);

  if (!open) return null;

  const handleStart = async () => {
    if (!selected || !onStart) return;
    setBusy(true);
    try {
      await onStart(selected.categoryCode, selected.breakdownCode, remarks.trim() || undefined);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!selected || !activeStoppage) return;
    setBusy(true);
    try {
      await onUpdate(activeStoppage.id, selected.categoryCode, selected.breakdownCode, remarks || undefined);
      if (needsRollChange && onRollChange && rollNo.trim()) {
        await onRollChange({
          rollPosition,
          newRollNo: rollNo.trim(),
          newRollCode: rollCode || undefined,
          reasonText: remarks || undefined,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!selected || !activeStoppage) return;
    setBusy(true);
    try {
      await onEnd(activeStoppage.id, selected.categoryCode, selected.breakdownCode, remarks || undefined);
      if (needsRollChange && onRollChange && rollNo.trim()) {
        await onRollChange({
          rollPosition,
          newRollNo: rollNo.trim(),
          newRollCode: rollCode || undefined,
          reasonText: remarks || undefined,
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !!selected && (!needsRollChange || rollNo.trim().length > 0);

  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-[110] bg-primary/50" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border border-border bg-white rounded-2xl p-5 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="shrink-0">
          <h3 className="text-lg font-bold text-foreground">
            {hasActiveStoppage ? 'Manage Stoppage' : 'Record Stoppage'}
          </h3>
          {hasActiveStoppage && (
            <div className="bg-destructive/10 rounded-xl px-4 py-3 mt-3 text-center flex items-center justify-between border border-destructive/30">
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Stoppage Active</p>
                <p className="text-xs text-destructive/80 mt-0.5">
                  Started {new Date(activeStoppage?.startAt || Date.now()).toLocaleTimeString()}
                </p>
              </div>
              <p className="font-mono text-3xl font-bold text-destructive">{stoppageTimer}</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-0 space-y-4 px-1 py-1">
          <FieldWrapper label="Stoppage Code">
            <select
              value={displayCode}
              onChange={(e) => setDisplayCode(e.target.value)}
              className="w-full min-h-14 rounded-xl border border-border bg-white px-3 text-base font-semibold"
            >
              {SixHi_STOPPAGE_CODES.map((c) => (
                <option key={c.displayCode} value={c.displayCode}>
                  {c.displayCode} — {c.label}
                </option>
              ))}
            </select>
          </FieldWrapper>

          {needsRollChange && (
            <div className="space-y-3 border border-border rounded-xl p-4 bg-secondary/60">
              <p className="text-sm font-bold text-foreground">Roll Change Details (Code 04)</p>
              <div className="flex gap-2">
                {(['IN', 'OUT'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setRollPosition(p)}
                    className={[
                      'flex-1 min-h-14 rounded-xl border text-sm font-semibold',
                      rollPosition === p ? 'bg-primary text-white border-primary' : 'border-border bg-white',
                    ].join(' ')}
                  >
                    Roll {p}
                  </button>
                ))}
              </div>
              <FieldWrapper label="New Roll No">
                <ZInput value={rollNo} onChange={(e) => setRollNo(e.target.value)} className="min-h-14 text-lg" />
              </FieldWrapper>
              <FieldWrapper label="Roll Code">
                <ZInput value={rollCode} onChange={(e) => setRollCode(e.target.value)} className="min-h-14 text-lg" />
              </FieldWrapper>
            </div>
          )}

          <FieldWrapper label="Description (optional)">
            <ZInput
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter stoppage description…"
              className="min-h-14 text-lg"
            />
          </FieldWrapper>
        </div>

        <div className="flex gap-2 justify-end pt-2 shrink-0 border-t border-border mt-2">
          <ZButton variant="ghost" onClick={onClose} className="min-h-14 flex-1">Cancel</ZButton>
          {!hasActiveStoppage ? (
            <ZButton variant="accent" onClick={handleStart} disabled={busy || !canSubmit || !onStart} className="min-h-14 flex-1">
              Confirm Stoppage
            </ZButton>
          ) : (
            <>
              <ZButton variant="primary" onClick={handleUpdate} disabled={busy || !canSubmit} className="min-h-14 flex-1">
                Save Details
              </ZButton>
              <ZButton variant="accent" onClick={handleEnd} disabled={busy || !canSubmit} className="min-h-14 flex-1">
                End Stoppage
              </ZButton>
            </>
          )}
        </div>
      </div>
    </>
  );
}
