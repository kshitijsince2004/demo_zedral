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
  value: number | '';
  onChange: (v: number | '') => void;
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
            const raw = e.target.value.trim();
            if (raw === '') {
              onChange('');
              return;
            }
            if (!/^(\d+(\.\d*)?|\.\d*)$/.test(raw)) return;
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
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

  const [t1, setT1] = useState<number | ''>('');
  const [t2, setT2] = useState<number | ''>('');
  const [t3, setT3] = useState<number | ''>('');
  const [weightMt, setWeightMt] = useState<number | ''>(planWeight || '');
  const [observedThk, setObservedThk] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Surface comes from PPC Current Order (plan); optional when plan blank (RWD-Q2).
    const capturedWeight = weightMt === '' ? planWeight : Number(weightMt);
    const outputThkMm = observedThk === '' ? planThk : Number(observedThk);

    setSubmitting(true);
    try {
      if (batchNumber) {
        await captureRwdOrder(batchNumber, {
          weightMt: capturedWeight,
          outputThkMm,
          rwTension1Kg: t1 === '' ? undefined : Number(t1),
          rwTension2Kg: t2 === '' ? undefined : Number(t2),
          rwTension3Kg: t3 === '' ? undefined : Number(t3),
          surfaceFinish: planSurface ?? undefined,
          complete: true,
        });
      } else {
        // Legacy CaptureWorkspace path — no order lifecycle.
        await submitProcessCapture('/production/rwd', {
          machineCode,
          shiftLogId,
          coilNo,
          widthMm: Number(pv<number>(prefill.widthMm) ?? 0),
          thkMm: planThk,
          weightMt: capturedWeight,
          outputThkMm,
          rwTension1Kg: t1 === '' ? undefined : Number(t1),
          rwTension2Kg: t2 === '' ? undefined : Number(t2),
          rwTension3Kg: t3 === '' ? undefined : Number(t3),
          surfaceFinish: planSurface ?? undefined,
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
