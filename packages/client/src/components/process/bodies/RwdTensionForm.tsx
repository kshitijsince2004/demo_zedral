import { useState, type FormEvent } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { submitProcessCapture } from '../../../store/processStore';
import { captureRwdOrder } from '../../../lib/rewindingWrites';
import type { BodyProps } from '../../../lib/processConfig';

type PrefillFieldLike<T> = { value: T; source?: string };

function pv<T>(f: unknown): T | undefined {
  if (f == null) return undefined;
  if (typeof f === 'object' && f !== null && 'value' in f) return (f as PrefillFieldLike<T>).value;
  return f as T;
}

/** Keep raw text so "1." / "1.0" survive keystrokes (Number() would collapse them). */
function isDecimalDraft(raw: string): boolean {
  return raw === '' || /^\d*(\.\d*)?$/.test(raw);
}

function parseDraftNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Unit-suffixed shop-floor input — matches 6HI production capture density. */
function UnitField({
  label,
  unit,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground">
        {label}
      </label>
      <div className="flex rounded-lg border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-primary/40 focus-within:border-primary">
        <input
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            const raw = e.target.value;
            if (isDecimalDraft(raw)) onChange(raw);
          }}
          className="flex-1 min-h-14 px-3 text-lg font-mono tabular-nums bg-transparent outline-none touch-manipulation"
        />
        <span className="shrink-0 min-h-14 px-3 flex items-center bg-muted text-muted-foreground text-xs font-bold tracking-wide border-l border-input">
          {unit}
        </span>
      </div>
    </div>
  );
}

export function RwdTensionForm({
  coilNo,
  prefill,
  shiftLogId,
  machineCode,
  batchNumber,
  onSubmitted,
  formId = 'rwd-capture-form',
  showSubmit = true,
}: BodyProps) {
  const planWeight = Number(pv<number>(prefill.weightMt) ?? 0);
  const planThk = Number(pv<number>(prefill.thicknessMm) ?? pv<number>(prefill.outputThkMmFallback) ?? 0);
  const planSurface = pv<'M' | 'B'>(prefill.surfaceFinish) ?? null;
  const planSurfaceBlank = planSurface == null;

  const [t1, setT1] = useState('');
  const [t2, setT2] = useState('');
  const [t3, setT3] = useState('');
  const [weightMt, setWeightMt] = useState(planWeight ? String(planWeight) : '');
  const [observedThk, setObservedThk] = useState('');
  // RWD-Q2: operator picks Matt/Bright only when plan surface is blank.
  const [surfacePick, setSurfacePick] = useState<'M' | 'B' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const surfaceFinish = planSurfaceBlank ? surfacePick : planSurface;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (planSurfaceBlank && !surfacePick) {
      setError('Select Matt or Bright surface finish');
      return;
    }

    const capturedWeight = weightMt.trim() === '' ? planWeight : parseDraftNum(weightMt);
    const outputThkMm = observedThk.trim() === '' ? planThk : parseDraftNum(observedThk);

    setSubmitting(true);
    try {
      if (batchNumber) {
        // Save ≠ End: write prod_rwd only; rail End marks COMPLETED.
        await captureRwdOrder(batchNumber, {
          weightMt: capturedWeight,
          outputThkMm,
          rwTension1Kg: t1.trim() === '' ? undefined : parseDraftNum(t1),
          rwTension2Kg: t2.trim() === '' ? undefined : parseDraftNum(t2),
          rwTension3Kg: t3.trim() === '' ? undefined : parseDraftNum(t3),
          surfaceFinish: surfaceFinish ?? undefined,
          complete: false,
        });
      } else {
        await submitProcessCapture('/production/rwd', {
          machineCode,
          shiftLogId,
          coilNo,
          widthMm: Number(pv<number>(prefill.widthMm) ?? 0),
          thkMm: planThk,
          weightMt: capturedWeight,
          outputThkMm,
          rwTension1Kg: t1.trim() === '' ? undefined : parseDraftNum(t1),
          rwTension2Kg: t2.trim() === '' ? undefined : parseDraftNum(t2),
          rwTension3Kg: t3.trim() === '' ? undefined : parseDraftNum(t3),
          surfaceFinish: surfaceFinish ?? undefined,
        }, coilNo);
      }
      await onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col">
      <div className="p-3 space-y-3">
        <UnitField
          label="Weight MT"
          unit="MT"
          value={weightMt}
          onChange={setWeightMt}
          placeholder={planWeight ? String(planWeight) : 'Enter weight'}
        />

        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1.5">
            RW Tension (KG)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <UnitField label="RW Tension 1 (KG)" unit="KG" value={t1} onChange={setT1} placeholder="Enter tension 1" />
            <UnitField label="RW Tension 2 (KG)" unit="KG" value={t2} onChange={setT2} placeholder="Enter tension 2" />
            <UnitField label="RW Tension 3 (KG)" unit="KG" value={t3} onChange={setT3} placeholder="Enter tension 3" />
          </div>
        </div>

        <UnitField
          label="Observed Thickness MM"
          unit="MM"
          value={observedThk}
          onChange={setObservedThk}
          placeholder={planThk ? `Default ${planThk}` : 'Enter observed thickness'}
        />

        {planSurfaceBlank ? (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1.5">
              Surface Finish
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { code: 'M' as const, label: 'Matt' },
                { code: 'B' as const, label: 'Bright' },
              ]).map((opt) => (
                <ZButton
                  key={opt.code}
                  type="button"
                  variant={surfacePick === opt.code ? 'primary' : 'secondary'}
                  onClick={() => setSurfacePick(opt.code)}
                  className="!min-h-12 !h-12 rounded-lg font-bold"
                >
                  {opt.label}
                </ZButton>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground mb-1">
              Surface Finish
            </p>
            <p className="text-sm font-semibold">{planSurface === 'B' ? 'Bright' : 'Matt'}</p>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      {showSubmit && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-3">
          <ZButton
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitting || !shiftLogId}
            className="min-h-14 text-base font-bold"
          >
            {submitting ? 'Saving…' : 'Save Production Data'}
          </ZButton>
        </div>
      )}
    </form>
  );
}
