import { useEffect, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { SixHi_STOPPAGE_CODES, findStoppageCodeDef } from './SixHiStoppageCodes';
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
  onUpdate: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onEnd: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onRollChange?: (data: RollChangePayload) => Promise<void>;
}

export function OrderStoppageModal({
  open,
  hasActiveStoppage,
  activeStoppage,
  onClose,
  onUpdate,
  onEnd,
  onRollChange,
}: OrderStoppageModalProps) {
  const [displayCode, setDisplayCode] = useState('12'); // Default to Operational
  const [remarks, setRemarks] = useState('');
  const [rollPosition, setRollPosition] = useState<'IN' | 'OUT'>('OUT');
  const [rollNo, setRollNo] = useState('');
  const [rollCode, setRollCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const selected = findStoppageCodeDef(displayCode);
  const needsRollChange = !!selected?.requiresRollChange;

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

  useEffect(() => {
    if (!open || !hasActiveStoppage || !activeStoppage?.startAt) return;
    const update = () => setElapsed(Math.max(0, Math.round((Date.now() - new Date(activeStoppage.startAt!).getTime()) / 60000)));
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, [open, hasActiveStoppage, activeStoppage?.startAt]);

  if (!open) return null;

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
          <h3 className="text-lg font-bold text-foreground">Active Machine Stoppage</h3>
          {hasActiveStoppage && (
            <div className="bg-[#FFEDD5] rounded-xl px-4 py-3 mt-3 text-center flex items-center justify-between border border-amber-200">
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Timer Running</p>
                <p className="text-xs text-amber-800/80 mt-0.5">Started at {new Date(activeStoppage?.startAt || Date.now()).toLocaleTimeString()}</p>
              </div>
              <p className="font-mono text-3xl font-bold text-amber-900">{elapsed} min</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-0 space-y-4 px-1 py-1">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Stoppage Code</p>
            <div className="grid grid-cols-3 gap-2">
              {SixHi_STOPPAGE_CODES.map((c) => (
                <button
                  key={c.displayCode}
                  type="button"
                  onClick={() => setDisplayCode(c.displayCode)}
                  className={[
                    'min-h-16 rounded-xl border text-left px-3 py-2 transition-colors',
                    displayCode === c.displayCode
                      ? 'bg-primary text-white border-primary'
                      : 'border-border bg-white text-foreground',
                  ].join(' ')}
                >
                  <span className="font-mono text-lg font-bold block">{c.displayCode}</span>
                  <span className="text-[10px] leading-tight opacity-90">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

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
                <ZInput
                  value={rollNo}
                  onChange={(e) => setRollNo(e.target.value)}
                  className="min-h-14 text-lg"
                  inputMode="text"
                  enterKeyHint="next"
                />
              </FieldWrapper>
              <FieldWrapper label="Roll Code">
                <ZInput
                  value={rollCode}
                  onChange={(e) => setRollCode(e.target.value)}
                  className="min-h-14 text-lg"
                  inputMode="text"
                  enterKeyHint="next"
                />
              </FieldWrapper>
            </div>
          )}

          <FieldWrapper label="Reason / Remarks">
            <ZInput
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Enter reason for stoppage…"
              className="min-h-14 text-lg"
              inputMode="text"
              enterKeyHint="done"
              autoFocus={!needsRollChange}
            />
          </FieldWrapper>
        </div>

        <div className="flex gap-2 justify-end pt-2 shrink-0 border-t border-border mt-2">
          <ZButton variant="ghost" onClick={onClose} className="min-h-14 flex-1">Hide</ZButton>
          <ZButton variant="primary" onClick={handleUpdate} disabled={busy || !canSubmit} className="min-h-14 flex-1">Save Details</ZButton>
          <ZButton variant="accent" onClick={handleEnd} disabled={busy || !canSubmit} className="min-h-14 flex-1">End Stoppage</ZButton>
        </div>
      </div>
    </>
  );
}
