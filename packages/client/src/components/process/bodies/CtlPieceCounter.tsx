import { useEffect, useMemo, useState } from 'react';
import { kgToMt } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import { submitProcessCapture, useProcessStore } from '../../../store/processStore';
import type { BodyProps } from '../../../lib/processConfig';

const BUNDLE_SLOTS = 4;

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

function distributeBundleWeightsKg(acceptedWeightKg: number, pieceCounts: number[]): number[] {
  const totalPcs = pieceCounts.reduce((a, b) => a + b, 0);
  if (acceptedWeightKg <= 0 || totalPcs <= 0) return pieceCounts.map(() => 0);
  return pieceCounts.map((pcs) =>
    pcs <= 0 ? 0 : Math.round(((acceptedWeightKg * pcs) / totalPcs) * 1000) / 1000,
  );
}

export function CtlPieceCounter({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const displayCoilNo = displayMotherCoilId({
    displayCoilNo: prefill.displayCoilNo != null ? String(prefill.displayCoilNo) : undefined,
    coilNo,
    batchNumber: prefill.batchNumber != null ? String(prefill.batchNumber) : coilNo,
    slitId: prefill.slitId != null ? String(prefill.slitId) : undefined,
    motherCoilNo: prefill.motherCoilNo != null ? String(prefill.motherCoilNo) : undefined,
  });
  const planWidth = Number(pv<number>(prefill.widthMm) ?? 0);
  const planThk = Number(pv<number>(prefill.thicknessMm) ?? 0);
  const planNominalLength = Number(pv<number>(prefill.nominalLengthMm) ?? 0);
  const planWeightMt = Number(pv<number>(prefill.weightMt) ?? 0);
  const plannedPcs = Number(pv<number>(prefill.plannedPcs) ?? 0);
  const plannedBundles = Number(pv<number>(prefill.plannedBundles) ?? 0);
  const prodVersion = String(pv<string>(prefill.prodVersion) ?? '');

  const [inputWeightKg, setInputWeightKg] = useState<number | ''>('');
  const [lengthSet, setLengthSet] = useState<number | ''>(planNominalLength || '');
  const [actualLength, setActualLength] = useState<number | ''>('');
  const [lineSpeed, setLineSpeed] = useState<number | ''>('');
  const [bundlePcs, setBundlePcs] = useState<number[]>([0, 0, 0, 0]);
  const [bundleWtKg, setBundleWtKg] = useState<(number | '')[]>(['', '', '', '']);
  const [autoBundleWeight, setAutoBundleWeight] = useState(true);
  const [rejectPcs, setRejectPcs] = useState<number | ''>('');
  const [rejectWtKg, setRejectWtKg] = useState<number | ''>('');
  const [holdMt, setHoldMt] = useState<number | ''>('');
  const [flatness, setFlatness] = useState<number | ''>('');
  const [squareness, setSquareness] = useState<number | ''>('');
  const [showSquarenessPrompt, setShowSquarenessPrompt] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const totalPcs = useMemo(() => bundlePcs.reduce((a, b) => a + b, 0), [bundlePcs]);
  const filledBundles = useMemo(() => bundlePcs.filter((n) => n > 0).length, [bundlePcs]);

  const weightMt = useMemo(
    () => (inputWeightKg === '' ? 0 : kgToMt(Number(inputWeightKg))),
    [inputWeightKg],
  );
  const rejectionMt = useMemo(
    () => (rejectWtKg === '' ? 0 : kgToMt(Number(rejectWtKg))),
    [rejectWtKg],
  );
  const acceptedKg = useMemo(() => {
    if (inputWeightKg === '') return 0;
    const rej = rejectWtKg === '' ? 0 : Number(rejectWtKg);
    return Math.max(0, Number(inputWeightKg) - rej);
  }, [inputWeightKg, rejectWtKg]);

  const autoWeights = useMemo(
    () => distributeBundleWeightsKg(acceptedKg, bundlePcs),
    [acceptedKg, bundlePcs],
  );

  const rejectionPct = useMemo(() => {
    if (inputWeightKg === '' || Number(inputWeightKg) <= 0 || rejectWtKg === '') return 0;
    return Math.round((Number(rejectWtKg) / Number(inputWeightKg)) * 10000) / 100;
  }, [inputWeightKg, rejectWtKg]);

  useEffect(() => {
    if (totalPcs > 0 && totalPcs % 50 === 0) setShowSquarenessPrompt(true);
  }, [totalPcs]);

  function setBundlePiece(index: number, value: number | '') {
    setBundlePcs((prev) => prev.map((v, i) => (i === index ? (value === '' ? 0 : Number(value)) : v)));
  }

  function setBundleWeight(index: number, value: number | '') {
    setBundleWtKg((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (inputWeightKg === '' || Number(inputWeightKg) <= 0) {
      setError('Input Weight (kg) is required');
      return;
    }
    if (lengthSet === '' || Number(lengthSet) <= 0) {
      setError('Length Set is required');
      return;
    }
    if (actualLength === '' || Number(actualLength) <= 0) {
      setError('Actual Length is required');
      return;
    }
    if (totalPcs <= 0) {
      setError('Enter pieces in at least one bundle');
      return;
    }
    if (showSquarenessPrompt && (flatness === '' || squareness === '')) {
      setError('Flatness and Squareness required every 50 pieces');
      return;
    }

    const totalProdMt = Math.max(0, weightMt - rejectionMt);
    const remarkParts = [
      remarks.trim(),
      rejectPcs !== '' ? `Reject pcs: ${rejectPcs}` : '',
      flatness !== '' ? `Flatness: ${flatness}` : '',
      squareness !== '' ? `Squareness: ${squareness}` : '',
    ].filter(Boolean);

    setSubmitting(true);
    try {
      await submitProcessCapture('/production/ctl', {
        machineCode,
        shiftLogId,
        coilNo,
        widthMm: planWidth || undefined,
        thkMm: planThk || undefined,
        weightMt,
        nominalSetLengthMm: Number(lengthSet),
        actualLengthMm: Number(actualLength),
        noPieces: totalPcs,
        noBundles: filledBundles || 1,
        totalProdMt,
        holdMt: holdMt === '' ? undefined : Number(holdMt),
        rejectionMt: rejectionMt || undefined,
        lowSpeed: lineSpeed === '' ? undefined : String(lineSpeed),
        remarks: remarkParts.join(' | ') || undefined,
        squarenessCheckDone: showSquarenessPrompt ? true : undefined,
      }, coilNo);
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
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnly label="Coil No" value={displayCoilNo} />
        <ReadOnly
          label="Customer"
          value={String(pv<string>(prefill.customerName) ?? '—')}
          source={prefill.customerName}
        />
        <ReadOnly label="Width mm" value={planWidth || '—'} source={prefill.widthMm} />
        <ReadOnly label="Thickness mm" value={planThk || '—'} source={prefill.thicknessMm} />
        <ReadOnly label="Nominal Length mm" value={planNominalLength || '—'} source={prefill.nominalLengthMm} />
        <ReadOnly label="Planned Pcs" value={plannedPcs || '—'} source={prefill.plannedPcs} />
        <ReadOnly
          label="Ref Weight MT"
          value={planWeightMt ? planWeightMt.toFixed(4) : '—'}
          source={prefill.weightMt}
        />
        <ReadOnly label="Grade" value={String(pv<string>(prefill.gradeCode) ?? '—')} source={prefill.gradeCode} />
        {prodVersion ? <ReadOnly label="Prod. Version" value={prodVersion} source={prefill.prodVersion} /> : null}
        {plannedBundles ? (
          <ReadOnly label="Plan Rows/Bundles" value={plannedBundles} source={prefill.plannedBundles} />
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ZInput
          label="Input Weight (kg)"
          type="number"
          value={inputWeightKg}
          onChange={(e) => setInputWeightKg(e.target.value === '' ? '' : Number(e.target.value))}
          required
        />
        <div className="bg-secondary/40 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase text-muted-foreground">Weight MT (derived)</p>
          <p className="font-semibold">{weightMt.toFixed(4)}</p>
        </div>
        <ZInput
          label="Length Set (mm)"
          type="number"
          value={lengthSet}
          onChange={(e) => setLengthSet(e.target.value === '' ? '' : Number(e.target.value))}
          required
        />
        <ZInput
          label="Actual Length (mm)"
          type="number"
          value={actualLength}
          onChange={(e) => setActualLength(e.target.value === '' ? '' : Number(e.target.value))}
          required
        />
        <ZInput
          label="Line Speed (m/min)"
          type="number"
          value={lineSpeed}
          onChange={(e) => setLineSpeed(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <ZInput
          label="Hold MT"
          type="number"
          value={holdMt}
          onChange={(e) => setHoldMt(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase text-muted-foreground">Bundles</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoBundleWeight}
            onChange={(e) => setAutoBundleWeight(e.target.checked)}
          />
          Auto bundle weight
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: BUNDLE_SLOTS }, (_, i) => (
          <div key={i} className="border rounded-lg p-2 space-y-2">
            <p className="text-xs text-center">Bundle {i + 1}</p>
            <ZInput
              label="Pcs"
              type="number"
              value={bundlePcs[i] || ''}
              onChange={(e) => setBundlePiece(i, e.target.value === '' ? '' : Number(e.target.value))}
            />
            <ZInput
              label="Wt kg"
              type="number"
              value={autoBundleWeight ? (autoWeights[i] || '') : bundleWtKg[i]}
              onChange={(e) => setBundleWeight(i, e.target.value === '' ? '' : Number(e.target.value))}
              disabled={autoBundleWeight}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ZInput
          label="Reject Pcs"
          type="number"
          value={rejectPcs}
          onChange={(e) => setRejectPcs(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <ZInput
          label="Reject Weight (kg)"
          type="number"
          value={rejectWtKg}
          onChange={(e) => setRejectWtKg(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Summary label="Total Pcs" value={String(totalPcs)} />
        <Summary label="Bundles" value={String(filledBundles)} />
        <Summary label="Rejection %" value={`${rejectionPct.toFixed(2)}%`} />
        <Summary label="Prod MT" value={(Math.max(0, weightMt - rejectionMt)).toFixed(4)} />
      </div>

      {showSquarenessPrompt && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium text-amber-800">Squareness check due (every 50 pcs)</p>
          <ZInput
            label="Flatness (mm)"
            type="number"
            value={flatness}
            onChange={(e) => setFlatness(e.target.value === '' ? '' : Number(e.target.value))}
          />
          <ZInput
            label="Squareness (mm)"
            type="number"
            value={squareness}
            onChange={(e) => setSquareness(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      )}

      <ZInput
        label="Remarks"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
      />

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <ZButton
        type="submit"
        disabled={submitting || (showSquarenessPrompt && (flatness === '' || squareness === ''))}
      >
        Submit CTL
      </ZButton>
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

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-secondary/30 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
