import { useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

type PrefillFieldLike<T> = { value: T; source?: string };

function pv<T>(f: unknown): T | undefined {
  if (f == null) return undefined;
  if (typeof f === 'object' && f !== null && 'value' in f) return (f as PrefillFieldLike<T>).value;
  return f as T;
}

function src(f: unknown): string | undefined {
  if (f && typeof f === 'object' && 'source' in f) return String((f as PrefillFieldLike<unknown>).source);
  return undefined;
}

function SourceTag({ field }: { field: unknown }) {
  const s = src(field);
  if (!s) return null;
  const label = s === 'Plan' ? 'from plan' : s === 'Prior' ? 'from prev' : s === 'Master' ? 'master' : s.toLowerCase();
  return <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground">({label})</span>;
}

export function RwdTensionForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const planWeight = Number(pv<number>(prefill.weightMt) ?? 0);
  const planThk = Number(pv<number>(prefill.thicknessMm) ?? pv<number>(prefill.outputThkMmFallback) ?? 0);
  const planSurface = pv<'M' | 'B'>(prefill.surfaceFinish) ?? null;
  const displayCoilNo = String(prefill.displayCoilNo ?? coilNo);

  const [t1, setT1] = useState<number | ''>('');
  const [t2, setT2] = useState<number | ''>('');
  const [t3, setT3] = useState<number | ''>('');
  const [weightMt, setWeightMt] = useState<number | ''>(planWeight || '');
  const [observedThk, setObservedThk] = useState<number | ''>('');
  const [surfaceFinish, setSurfaceFinish] = useState<'M' | 'B' | null>(planSurface);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const surfaceLocked = planSurface != null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const surface = surfaceLocked ? planSurface : surfaceFinish;
    if (!surface) {
      setError('Surface Finish is required when the plan has no surface');
      return;
    }

    // RWD-Q4: captured weight = override ?? plan
    const capturedWeight = weightMt === '' ? planWeight : Number(weightMt);
    // RWD-Q1: blank observed → Pre-Stage thickness
    const outputThkMm = observedThk === '' ? planThk : Number(observedThk);

    setSubmitting(true);
    try {
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
        surfaceFinish: surface,
      }, coilNo);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnly label="Coil No" value={displayCoilNo} />
        <ReadOnly
          label="Customer"
          value={String(pv<string>(prefill.customerName) ?? '—')}
          source={prefill.customerName}
        />
        <ReadOnly
          label="Width mm"
          value={Number(pv<number>(prefill.widthMm) ?? 0)}
          source={prefill.widthMm}
        />
        <ReadOnly
          label="Pre-Stage Thickness mm"
          value={planThk}
          source={prefill.thicknessMm ?? prefill.outputThkMmFallback}
        />
        <ReadOnly
          label="Grade"
          value={String(pv<string>(prefill.gradeCode) ?? '—')}
          source={prefill.gradeCode}
        />
        <ZInput
          label="Weight MT"
          type="number"
          value={weightMt}
          onChange={(e) => setWeightMt(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['RW Tension 1', 'RW Tension 2', 'RW Tension 3'] as const).map((label, i) => (
          <ZInput
            key={label}
            label={`${label} (kg)`}
            type="number"
            value={[t1, t2, t3][i]}
            onChange={(e) => {
              const v = e.target.value === '' ? '' : Number(e.target.value);
              if (i === 0) setT1(v);
              if (i === 1) setT2(v);
              if (i === 2) setT3(v);
            }}
          />
        ))}
      </div>

      <ZInput
        label="Observed Thickness mm"
        type="number"
        value={observedThk}
        onChange={(e) => setObservedThk(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={planThk ? `Default ${planThk}` : undefined}
      />

      <div>
        <p className="text-[10px] uppercase text-muted-foreground mb-1">
          Surface Finish
          {surfaceLocked && <SourceTag field={prefill.surfaceFinish} />}
        </p>
        {surfaceLocked ? (
          <p className="font-semibold px-3 py-2 bg-secondary/40 rounded-lg">
            {planSurface === 'B' ? 'Bright' : 'Matt'}
          </p>
        ) : (
          <div className="flex gap-2">
            {([
              { code: 'M' as const, label: 'Matt' },
              { code: 'B' as const, label: 'Bright' },
            ]).map((finish) => (
              <ZButton
                key={finish.code}
                type="button"
                variant={surfaceFinish === finish.code ? 'primary' : 'secondary'}
                onClick={() => setSurfaceFinish(finish.code)}
              >
                {finish.label}
              </ZButton>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <ZButton type="submit" disabled={submitting}>Submit RWD</ZButton>
    </form>
  );
}

function ReadOnly({
  label,
  value,
  source,
}: {
  label: string;
  value: string | number;
  source?: unknown;
}) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">
        {label}
        <SourceTag field={source} />
      </p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
