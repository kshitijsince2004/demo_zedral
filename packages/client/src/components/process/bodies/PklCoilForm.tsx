import { useMemo, useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture, useProcessStore } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';
import { ProcessPairedField, deltaBand } from '../ProcessPairedField';

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

/** PKL coil capture — operator inputs only; identity lives on PPC card (revamp §5). */
export function PklCoilForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const pklGroupCoilNos = useProcessStore((s) => s.pklGroupCoilNos);
  const pklGroupWeightMt = useProcessStore((s) => s.pklGroupWeightMt);
  const ppcWeight = fieldNum((prefill as { ppcWeightMt?: unknown }).ppcWeightMt) || fieldNum(prefill.weightMt);
  const [weightMt, setWeightMt] = useState(ppcWeight);
  const [lineSpeed, setLineSpeed] = useState<number | ''>('');
  const [wp, setWp] = useState<'W' | 'P' | ''>('');
  // ponytail: label "Leader End"; keep endFilling key (no migration)
  const [endFilling, setEndFilling] = useState<boolean | null>(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const motherCoilNo = fieldVal((prefill as { motherCoilNo?: unknown }).motherCoilNo)
    ?? fieldVal((prefill as { parentCoilNo?: unknown }).parentCoilNo);
  const slitId = fieldVal((prefill as { slitId?: unknown }).slitId);
  const gradeCode = fieldVal(prefill.gradeCode);
  const customerName = fieldVal(prefill.customerName);
  const widthMm = fieldNum(prefill.widthMm);
  const thkMm = fieldNum(prefill.thicknessMm);

  const weightCue = useMemo(
    () => deltaBand(weightMt || undefined, ppcWeight || undefined, Math.max(0.01, ppcWeight * 0.02)),
    [weightMt, ppcWeight],
  );
  const weightWarn = weightCue.band === 'warn';

  function buildPayload() {
    return {
      machineCode,
      shiftLogId: String(shiftLogId),
      coilNo,
      widthMm,
      thkMm,
      weightMt,
      ppcWeightMt: ppcWeight || undefined,
      lineSpeedMpm: Number(lineSpeed),
      wp: wp as 'W' | 'P',
      endFilling: endFilling as boolean,
      motherCoilNo,
      slitId,
      customer: customerName,
      gradeCode,
      routeRaw: fieldVal((prefill as { routeRaw?: unknown }).routeRaw),
      remarks: remarks || undefined,
    };
  }

  function validateFields(): string | null {
    if (!shiftLogId) return 'No active shift — open a shift before saving';
    if (lineSpeed === '' || Number(lineSpeed) <= 0) return 'Line speed required';
    if (wp !== 'W' && wp !== 'P') return 'W/P required';
    if (endFilling == null) return 'Leader End required (Yes/No)';
    return null;
  }

  /** Mid-run save — persist only; timer/order stay active. */
  async function handleSaveOnly() {
    setError(null);
    setMsg(null);
    const invalid = validateFields();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/pkl/draft', buildPayload(), coilNo);
      setMsg('Production data saved. Order still in progress — use End on the rail to complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  /** Rail End → OrderEndModal → form.requestSubmit — finalize order. */
  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const invalid = validateFields();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/pkl', buildPayload(), coilNo);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleComplete} className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <ProcessPairedField
          planLabel="PPC Weight MT (plan)"
          planValue={ppcWeight || '—'}
          band={weightCue.band}
          deltaLabel={weightCue.label}
          actualControl={
            <ZInput label="Weight MT (actual)" type="number" value={weightMt || ''} onChange={(e) => setWeightMt(Number(e.target.value))} />
          }
        />
        {pklGroupCoilNos.length > 1 && (
          <div className="bg-secondary/40 rounded-lg px-3 py-2">
            <p className="text-[10px] uppercase text-muted-foreground">Group Σ Weight MT</p>
            <p className="font-semibold font-mono">{pklGroupWeightMt.toFixed(2)}</p>
          </div>
        )}
        <ZInput label="Line Speed M/min" type="number" value={lineSpeed} onChange={(e) => setLineSpeed(e.target.value === '' ? '' : Number(e.target.value))} />
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
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Leader End</p>
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
        <p className="text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
          Weight differs from PPC order weight {ppcWeight} MT (advisory).
        </p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {msg && <p className="text-sm text-success">{msg}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <ZButton type="button" disabled={submitting} onClick={() => void handleSaveOnly()}>
          {submitting ? 'Saving…' : 'Save Production'}
        </ZButton>
        <p className="text-xs text-muted-foreground">
          Saves data only. To complete the order, use <span className="font-semibold text-foreground">End</span> on the right rail.
        </p>
      </div>
    </form>
  );
}
