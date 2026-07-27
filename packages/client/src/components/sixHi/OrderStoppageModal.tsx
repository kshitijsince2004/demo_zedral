import { useEffect, useState } from 'react';
import { ZButton } from '../primitives/ZButton';
import { ZInput } from '../primitives/ZInput';
import { FieldWrapper } from '../forms/FieldWrapper';
import { StoppageCodeSelect } from './StoppageCodeSelect';
import { useSixHiStoppageCodes, findStoppageCodeDef, resolveStoppageDisplayCode } from './SixHiStoppageCodes';
import { StoppageTimerText } from './ProductionTimerDisplay';
import { formatPlantClock } from '../../lib/dateFormat';
import type { SixHiOrderStoppage } from '@m1/shared-validation';

export interface RollChangePayload {
  rollPosition: 'IN' | 'OUT';
  newRollNo: string;
  newRollCode?: string;
  reasonText?: string;
}

interface RollDetailsState {
  rollInNo: string;
  rollInCode: string;
  rollOutNo: string;
  rollOutCode: string;
}

interface OrderStoppageModalProps {
  open: boolean;
  hasActiveStoppage: boolean;
  activeStoppage?: SixHiOrderStoppage;
  initialRollInNo?: string;
  initialRollInCode?: string;
  initialRollOutNo?: string;
  initialRollOutCode?: string;
  subtitle?: string;
  title?: string;
  startButtonLabel?: string;
  /** When 'before', roll changes are applied before start/update/end (manual stoppage). */
  rollChangeTiming?: 'before' | 'after';
  onClose: () => void;
  onStart?: (categoryCode: string, breakdownCode: string | undefined, remarks?: string) => Promise<void>;
  onUpdate: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onEnd: (stoppageId: string, categoryCode: string, breakdownCode?: string, remarks?: string) => Promise<void>;
  onRollChange?: (data: RollChangePayload) => Promise<void>;
}

function buildRollDetails(
  rollInNo?: string,
  rollInCode?: string,
  rollOutNo?: string,
  rollOutCode?: string,
): RollDetailsState {
  return {
    rollInNo: rollInNo ?? '',
    rollInCode: rollInCode ?? '',
    rollOutNo: rollOutNo ?? '',
    rollOutCode: rollOutCode ?? '',
  };
}

async function applyRollChanges(
  onRollChange: ((data: RollChangePayload) => Promise<void>) | undefined,
  rolls: RollDetailsState,
  reasonText?: string,
) {
  if (!onRollChange) return;
  if (rolls.rollInNo.trim()) {
    await onRollChange({
      rollPosition: 'IN',
      newRollNo: rolls.rollInNo.trim(),
      newRollCode: rolls.rollInCode.trim() || undefined,
      reasonText,
    });
  }
  if (rolls.rollOutNo.trim()) {
    await onRollChange({
      rollPosition: 'OUT',
      newRollNo: rolls.rollOutNo.trim(),
      newRollCode: rolls.rollOutCode.trim() || undefined,
      reasonText,
    });
  }
}

export function OrderStoppageModal({
  open,
  hasActiveStoppage,
  activeStoppage,
  initialRollInNo,
  initialRollInCode,
  initialRollOutNo,
  initialRollOutCode,
  subtitle,
  title,
  startButtonLabel = 'Confirm Stoppage',
  rollChangeTiming = 'after',
  onClose,
  onStart,
  onUpdate,
  onEnd,
  onRollChange,
}: OrderStoppageModalProps) {
  const { codes: stoppageCodes, loading: codesLoading } = useSixHiStoppageCodes();
  const [displayCode, setDisplayCode] = useState('12');
  const [remarks, setRemarks] = useState('');
  const [rolls, setRolls] = useState<RollDetailsState>(() =>
    buildRollDetails(initialRollInNo, initialRollInCode, initialRollOutNo, initialRollOutCode),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = findStoppageCodeDef(displayCode);
  const needsRollChange = !!selected?.requiresRollChange;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (activeStoppage) {
      setDisplayCode(resolveStoppageDisplayCode(activeStoppage.categoryCode, activeStoppage.breakdownCode));
      setRemarks(activeStoppage.remarks || '');
      setRolls(buildRollDetails(initialRollInNo, initialRollInCode, initialRollOutNo, initialRollOutCode));
    } else {
      const defaultCode = stoppageCodes.find((c) => c.displayCode === '12')?.displayCode ?? stoppageCodes[0]?.displayCode ?? '12';
      setDisplayCode(defaultCode);
      setRemarks('');
      setRolls(buildRollDetails(initialRollInNo, initialRollInCode, initialRollOutNo, initialRollOutCode));
    }
  }, [open, activeStoppage, stoppageCodes, initialRollInNo, initialRollInCode, initialRollOutNo, initialRollOutCode]);

  if (!open) return null;

  const canSubmitStart = !!selected;
  const canSubmitEnd = !!selected;

  const handleStart = async () => {
    if (!selected || !onStart || !canSubmitStart) return;
    setBusy(true);
    setError(null);
    try {
      if (needsRollChange && rollChangeTiming === 'before') {
        await applyRollChanges(onRollChange, rolls, remarks.trim() || undefined);
      }
      await onStart(selected.categoryCode, selected.breakdownCode, remarks.trim() || undefined);
      if (needsRollChange && rollChangeTiming === 'after') {
        await applyRollChanges(onRollChange, rolls, remarks.trim() || undefined);
      }
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to start stoppage');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!selected || !activeStoppage || !canSubmitStart) return;
    setBusy(true);
    setError(null);
    try {
      if (needsRollChange && rollChangeTiming === 'before') {
        await applyRollChanges(onRollChange, rolls, remarks || undefined);
      }
      await onUpdate(activeStoppage.id, selected.categoryCode, selected.breakdownCode, remarks || undefined);
      if (needsRollChange && rollChangeTiming === 'after') {
        await applyRollChanges(onRollChange, rolls, remarks || undefined);
      }
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to update stoppage');
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    if (!selected || !activeStoppage || !canSubmitEnd) return;
    setBusy(true);
    setError(null);
    try {
      if (needsRollChange && rollChangeTiming === 'before') {
        await applyRollChanges(onRollChange, rolls, remarks || undefined);
      }
      await onEnd(activeStoppage.id, selected.categoryCode, selected.breakdownCode, remarks || undefined);
      if (needsRollChange && rollChangeTiming === 'after') {
        await applyRollChanges(onRollChange, rolls, remarks || undefined);
      }
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to end stoppage');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-[110] bg-primary/50" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[115] w-full max-w-lg mx-auto border border-border bg-white rounded-2xl p-5 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="shrink-0">
          <h3 className="text-lg font-bold text-foreground">
            {title ?? (hasActiveStoppage ? 'Manage Stoppage' : 'Record Stoppage')}
          </h3>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
          {hasActiveStoppage && (
            <div className="bg-destructive/10 rounded-xl px-4 py-3 mt-3 text-center flex items-center justify-between border border-destructive/30">
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Stoppage Active</p>
                <p className="text-xs text-destructive/80 mt-0.5">
                  Started {formatPlantClock(activeStoppage?.startAt || Date.now())}
                </p>
              </div>
              <StoppageTimerText
                startAt={activeStoppage?.startAt}
                active={hasActiveStoppage}
                className="font-mono text-3xl font-bold text-destructive"
              />
            </div>
          )}
          {error && (
            <p className="mt-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-0 space-y-4 px-1 py-1">
          <FieldWrapper label="Stoppage Code">
            <StoppageCodeSelect
              value={displayCode}
              onChange={setDisplayCode}
              codes={stoppageCodes}
              loading={codesLoading}
            />
          </FieldWrapper>

          {needsRollChange && (
            <div className="space-y-4">
              <div className="space-y-3 border border-border rounded-xl p-4 bg-secondary/60">
                <p className="text-sm font-bold text-foreground">Roll In Details</p>
                <FieldWrapper label="Roll In No">
                  <ZInput
                    value={rolls.rollInNo}
                    onChange={(e) => setRolls((prev) => ({ ...prev, rollInNo: e.target.value }))}
                    className="min-h-14 text-lg"
                  />
                </FieldWrapper>
                <FieldWrapper label="Roll In Code">
                  <ZInput
                    value={rolls.rollInCode}
                    onChange={(e) => setRolls((prev) => ({ ...prev, rollInCode: e.target.value }))}
                    className="min-h-14 text-lg"
                  />
                </FieldWrapper>
              </div>

              <div className="space-y-3 border border-border rounded-xl p-4 bg-secondary/60">
                <p className="text-sm font-bold text-foreground">Roll Out Details</p>
                <FieldWrapper label="Roll Out No">
                  <ZInput
                    value={rolls.rollOutNo}
                    onChange={(e) => setRolls((prev) => ({ ...prev, rollOutNo: e.target.value }))}
                    className="min-h-14 text-lg"
                  />
                </FieldWrapper>
                <FieldWrapper label="Roll Out Code">
                  <ZInput
                    value={rolls.rollOutCode}
                    onChange={(e) => setRolls((prev) => ({ ...prev, rollOutCode: e.target.value }))}
                    className="min-h-14 text-lg"
                  />
                </FieldWrapper>
              </div>
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
            <ZButton variant="accent" onClick={handleStart} disabled={busy || !canSubmitStart || !onStart} className="min-h-14 flex-1">
              {startButtonLabel}
            </ZButton>
          ) : (
            <>
              <ZButton variant="primary" onClick={handleUpdate} disabled={busy || !canSubmitStart} className="min-h-14 flex-1">
                Save Details
              </ZButton>
              <ZButton variant="accent" onClick={handleEnd} disabled={busy || !canSubmitEnd} className="min-h-14 flex-1">
                End Stoppage
              </ZButton>
            </>
          )}
        </div>
      </div>
    </>
  );
}
