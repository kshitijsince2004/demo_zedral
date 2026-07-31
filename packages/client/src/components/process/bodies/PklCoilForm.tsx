import { useMemo, useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture, useProcessStore } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

function fieldVal(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const v = (raw as { value: unknown }).value;
    if (v == null || v === '') return undefined;
    return String(v);
  }
  return String(raw);
}

function fieldNum(raw: unknown): number {
  const s = fieldVal(raw);
  if (s == null) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** PKL coil capture — operator fields only; autofill from prior/PPC (plan §5). */
export function PklCoilForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const pklGroupCoilNos = useProcessStore((s) => s.pklGroupCoilNos);
  const pklGroupWeightMt = useProcessStore((s) => s.pklGroupWeightMt);
  const ppcWeight = fieldNum((prefill as { ppcWeightMt?: unknown }).ppcWeightMt) || fieldNum(prefill.weightMt);
  const [weightMt, setWeightMt] = useState(ppcWeight);
  const [lineSpeed, setLineSpeed] = useState<number | ''>('');
  const [repeats, setRepeats] = useState(0);
  const [ht, setHt] = useState('');
  const [wp, setWp] = useState<'W' | 'P' | ''>('');
  const [endFilling, setEndFilling] = useState<boolean | null>(null);
  const [heatNo, setHeatNo] = useState(fieldVal(prefill.heatNo) ?? '');
  const [source, setSource] = useState(fieldVal(prefill.source) ?? '');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const motherCoilNo = fieldVal((prefill as { motherCoilNo?: unknown }).motherCoilNo)
    ?? fieldVal((prefill as { parentCoilNo?: unknown }).parentCoilNo);
  const slitId = fieldVal((prefill as { slitId?: unknown }).slitId);
  const gradeCode = fieldVal(prefill.gradeCode);
  const customerName = fieldVal(prefill.customerName);
  const widthMm = fieldNum(prefill.widthMm);
  const thkMm = fieldNum(prefill.thicknessMm);

  const weightWarn = useMemo(() => {
    if (!ppcWeight || !weightMt) return false;
    return Math.abs(weightMt - ppcWeight) > ppcWeight * 0.02;
  }, [weightMt, ppcWeight]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (lineSpeed === '' || Number(lineSpeed) <= 0) {
      setError('Line speed required');
      return;
    }
    if (wp !== 'W' && wp !== 'P') {
      setError('W/P required');
      return;
    }
    if (endFilling == null) {
      setError('End Filling required (Yes/No)');
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/pkl', {
        machineCode,
        shiftLogId,
        coilNo,
        widthMm,
        thkMm,
        weightMt,
        ppcWeightMt: ppcWeight || undefined,
        lineSpeedMpm: Number(lineSpeed),
        heatNo: heatNo || undefined,
        source: source || undefined,
        repeats,
        ht: ht || undefined,
        wp,
        endFilling,
        motherCoilNo,
        slitId,
        customer: customerName,
        gradeCode,
        routeRaw: fieldVal((prefill as { routeRaw?: unknown }).routeRaw),
        remarks: remarks || undefined,
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
        <ReadOnly label="Coil No" value={coilNo} />
        <ReadOnly label="Grade" value={gradeCode ?? '—'} />
        <ReadOnly label="Customer" value={customerName ?? '—'} />
        <ReadOnly label="Mother / Slit" value={`${motherCoilNo ?? '—'} / ${slitId ?? '—'}`} />
        <ReadOnly label="Width mm" value={widthMm} />
        <ReadOnly label="Thk mm" value={thkMm} />
        <ZInput label="Weight MT (PPC ref)" type="number" value={weightMt || ''} onChange={(e) => setWeightMt(Number(e.target.value))} />
        <ReadOnly label="PPC Weight" value={ppcWeight || '—'} />
        {pklGroupCoilNos.length > 1 && (
          <ReadOnly label="Group Σ Weight MT" value={pklGroupWeightMt.toFixed(2)} />
        )}
        <ZInput label="Line Speed mpm" type="number" value={lineSpeed} onChange={(e) => setLineSpeed(e.target.value === '' ? '' : Number(e.target.value))} />
        <ZInput label="Repeats" type="number" value={repeats} onChange={(e) => setRepeats(Number(e.target.value) || 0)} />
        <ZInput label="HT" value={ht} onChange={(e) => setHt(e.target.value)} />
        <ZInput label="Heat No" value={heatNo} onChange={(e) => setHeatNo(e.target.value)} />
        <ZInput label="Source" value={source} onChange={(e) => setSource(e.target.value)} />
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">W/P</p>
          <select
            className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm"
            value={wp}
            onChange={(e) => setWp(e.target.value as 'W' | 'P' | '')}
          >
            <option value="">Select…</option>
            <option value="W">W</option>
            <option value="P">P</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">End Filling</p>
          <select
            className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm"
            value={endFilling == null ? '' : endFilling ? 'Y' : 'N'}
            onChange={(e) => setEndFilling(e.target.value === '' ? null : e.target.value === 'Y')}
          >
            <option value="">Select…</option>
            <option value="Y">Yes</option>
            <option value="N">No</option>
          </select>
        </div>
        <ZInput label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>

      {weightWarn && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Weight differs from PPC order weight {ppcWeight} MT (advisory).
        </p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <ZButton type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit PKL'}</ZButton>
    </form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
