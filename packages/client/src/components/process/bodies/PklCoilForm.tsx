import { useEffect, useMemo, useState } from 'react';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture, useProcessStore } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';
import { ProcessPairedField, deltaBand } from '../ProcessPairedField';

type PklCapture = {
  weightMt?: number;
  ppcWeightMt?: number;
  lineSpeedMpm?: number;
  wp?: 'W' | 'P';
  endFilling?: boolean;
  remarks?: string;
};

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

/** Keep raw text so operators can type decimals ("1.", ".5") without Number() collapsing them. */
function isDecimalDraft(raw: string): boolean {
  return raw === '' || /^-?\d*\.?\d*$/.test(raw);
}

function parseDraftNum(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** PKL coil capture — operator inputs only; identity lives on PPC card (revamp §5). */
export function PklCoilForm({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const pklGroupCoilNos = useProcessStore((s) => s.pklGroupCoilNos);
  const pklGroupWeightMt = useProcessStore((s) => s.pklGroupWeightMt);
  const isCompleted = useProcessStore((s) =>
    s.queue.find((c) => c.coilNo === coilNo)?.status === 'COMPLETED',
  );
  const pklCapture = (prefill as { pklCapture?: PklCapture | null }).pklCapture;
  const ppcWeight = fieldNum((prefill as { ppcWeightMt?: unknown }).ppcWeightMt)
    || fieldNum(pklCapture?.ppcWeightMt)
    || fieldNum(prefill.weightMt);
  const [weightMt, setWeightMt] = useState(() => (ppcWeight ? String(ppcWeight) : ''));
  const [lineSpeed, setLineSpeed] = useState('');
  const [wp, setWp] = useState<'W' | 'P' | ''>('');
  // ponytail: label "Leader End"; keep endFilling key (no migration)
  const [endFilling, setEndFilling] = useState<boolean | null>(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!pklCapture) return;
    if (pklCapture.weightMt != null) setWeightMt(String(pklCapture.weightMt));
    if (pklCapture.lineSpeedMpm != null) setLineSpeed(String(pklCapture.lineSpeedMpm));
    if (pklCapture.wp === 'W' || pklCapture.wp === 'P') setWp(pklCapture.wp);
    if (pklCapture.endFilling != null) setEndFilling(pklCapture.endFilling);
    if (pklCapture.remarks != null) setRemarks(pklCapture.remarks);
  }, [coilNo, pklCapture]);

  const motherCoilNo = fieldVal((prefill as { motherCoilNo?: unknown }).motherCoilNo)
    ?? fieldVal((prefill as { parentCoilNo?: unknown }).parentCoilNo);
  const slitId = fieldVal((prefill as { slitId?: unknown }).slitId);
  const gradeCode = fieldVal(prefill.gradeCode);
  const customerName = fieldVal(prefill.customerName);
  const widthMm = fieldNum(prefill.widthMm);
  const thkMm = fieldNum(prefill.thicknessMm);
  const weightNum = parseDraftNum(weightMt);

  const weightCue = useMemo(
    () => deltaBand(weightNum || undefined, ppcWeight || undefined, Math.max(0.01, ppcWeight * 0.02)),
    [weightNum, ppcWeight],
  );
  const weightWarn = weightCue.band === 'warn';

  function buildPayload() {
    return {
      machineCode,
      shiftLogId: String(shiftLogId),
      coilNo,
      widthMm,
      thkMm,
      weightMt: weightNum,
      ppcWeightMt: ppcWeight || undefined,
      lineSpeedMpm: parseDraftNum(lineSpeed),
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
    const speed = Number(lineSpeed);
    if (lineSpeed === '' || !Number.isFinite(speed) || speed <= 0) return 'Line speed required';
    if (wp !== 'W' && wp !== 'P') return 'W/P required';
    if (endFilling == null) return 'Leader End required (Yes/No)';
    return null;
  }

  /** Mid-run save — persist only; timer/order stay active. */
  async function handleSaveOnly() {
    if (isCompleted) return;
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
    if (isCompleted) return;
    setError(null);
    setMsg(null);
    const invalid = validateFields();
    if (invalid) {
      setError(invalid);
      useProcessStore.getState().settleEndCaptureError(invalid);
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/pkl', buildPayload(), coilNo);
      onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submit failed';
      setError(msg);
      useProcessStore.getState().settleEndCaptureError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleComplete} className="space-y-4 p-4">
      <fieldset disabled={isCompleted} className="min-w-0 space-y-4 border-0 p-0 m-0">
        <div className="grid grid-cols-2 gap-3">
          <ProcessPairedField
            planLabel="PPC Weight MT (plan)"
            planValue={ppcWeight || '—'}
            band={weightCue.band}
            deltaLabel={weightCue.label}
            actualControl={
              <ZInput
                label="Weight MT (actual)"
                type="number"
                value={weightMt}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (isDecimalDraft(raw)) setWeightMt(raw);
                }}
              />
            }
          />
          {pklGroupCoilNos.length > 1 && (
            <div className="bg-secondary/40 rounded-lg px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground">Group Σ Weight MT</p>
              <p className="font-semibold font-mono">{pklGroupWeightMt.toFixed(2)}</p>
            </div>
          )}
          <ZInput
            label="Line Speed M/min"
            type="number"
            value={lineSpeed}
            onChange={(e) => {
              const raw = e.target.value;
              if (isDecimalDraft(raw)) setLineSpeed(raw);
            }}
          />
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">W/P</p>
            <select
              className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-70"
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
              className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-70"
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
      </fieldset>

      {weightWarn && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
          Weight differs from PPC order weight {ppcWeight} MT (advisory).
        </p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
      {msg && <p className="text-sm text-success">{msg}</p>}
      {isCompleted ? (
        <p className="text-xs text-muted-foreground">Completed — saved input details (read only).</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <ZButton type="button" variant="primary" disabled={submitting} onClick={() => void handleSaveOnly()}>
            {submitting ? 'Saving…' : 'Save Production'}
          </ZButton>
          <p className="text-xs text-muted-foreground">
            Saves data only. To complete the order, use <span className="font-semibold text-foreground">End</span> on the right rail.
          </p>
        </div>
      )}
    </form>
  );
}
