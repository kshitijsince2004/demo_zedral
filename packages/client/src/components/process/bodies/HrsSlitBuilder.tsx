import { useEffect, useMemo, useState } from 'react';
import { calculateScrapPct, crsMassBalanceWarn } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import { apiClient } from '../../../lib/apiClient';
import type { BodyProps } from '../../../lib/processConfig';

// ponytail: UI cap 12; model is unbounded
const MAX_SLOTS = 12;

type OrderLine = {
  batchNumber?: string;
  widthMm?: number;
  weightMt?: number;
  thicknessMm?: number;
  finishThicknessMm?: number;
  customerName?: string;
  routeRaw?: string;
  slitId?: string;
  surfaceFinish?: string;
  toWorkCenter?: string;
};

interface HrsLine {
  slot: string;
  childCoilNo: string;
  targetWidthMm?: number;
  actualWidthMm?: number;
  plannedThkMm?: number;
  thkIdMm?: number;
  thkCentreMm?: number;
  thkOdMm?: number;
  plannedWeightMt?: number;
  actualWeightMt?: number;
  taper: string;
  customer: string;
  sapBatchNumber: string;
  surfaceFinish: string;
  finishThicknessMm?: number;
  routeRaw: string;
  downstreamCrsCombination: string;
  holdFlag: boolean;
  forCtlFlag: boolean;
}

function nextSlot(used: string[]): string {
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i);
    if (!used.includes(L)) return L;
  }
  return `S${used.length + 1}`;
}

function flagsFromRoute(routeRaw: string, toWorkCenter?: string) {
  const r = routeRaw.toUpperCase().replace(/\s+/g, '');
  const hold = r === 'SZ' || toWorkCenter === 'Z' || r.includes('HOLD');
  const forCtl = r.includes('CLE');
  return { holdFlag: hold, forCtlFlag: forCtl && !hold };
}

export function HrsSlitBuilder({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const [motherWidth, setMotherWidth] = useState(Number(prefill.widthMm ?? 0));
  const [actualMotherWidth, setActualMotherWidth] = useState(Number(prefill.widthMm ?? 0));
  const [motherWt, setMotherWt] = useState(Number(prefill.weightMt ?? 0));
  const [scrapMt, setScrapMt] = useState(0);
  const [lines, setLines] = useState<HrsLine[]>([]);
  const [specVersionId, setSpecVersionId] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!coilNo) return;
    let cancelled = false;
    const q = new URLSearchParams({ process: 'HRS', by: 'coil', coilNo, mode: 'snapshot' });
    void apiClient
      .get<Array<{ versionId: number }>>(`/quality/fetch?${q}`)
      .then((rows) => {
        if (!cancelled && rows?.[0]?.versionId) setSpecVersionId(rows[0].versionId);
      })
      .catch(() => { /* missing spec ⇒ NOT_EVALUATED */ });
    return () => { cancelled = true; };
  }, [coilNo]);

  useEffect(() => {
    const orderLines = (prefill as { orderLines?: OrderLine[] }).orderLines;
    if (!orderLines?.length || lines.length > 0) return;
    setLines(orderLines.slice(0, MAX_SLOTS).map((ol, i) => {
      const slot = (ol.slitId?.trim().toUpperCase() || String.fromCharCode(65 + i)).slice(0, 8);
      const flags = flagsFromRoute(ol.routeRaw ?? '', ol.toWorkCenter);
      return {
        slot,
        childCoilNo: `${coilNo}-${slot}`,
        targetWidthMm: ol.widthMm,
        plannedThkMm: ol.thicknessMm ?? (Number(prefill.thicknessMm ?? 0) || undefined),
        plannedWeightMt: ol.weightMt,
        taper: '',
        customer: ol.customerName ?? '',
        sapBatchNumber: ol.batchNumber ?? coilNo,
        surfaceFinish: ol.surfaceFinish ?? '',
        finishThicknessMm: ol.finishThicknessMm,
        routeRaw: ol.routeRaw ?? '',
        downstreamCrsCombination: '',
        ...flags,
      };
    }));
  }, [coilNo, prefill, lines.length]);

  const producedMt = useMemo(
    () => lines.reduce((s, l) => s + (l.actualWeightMt ?? 0), 0),
    [lines],
  );
  const scrapPct = useMemo(
    () => calculateScrapPct(scrapMt, motherWt || producedMt),
    [scrapMt, motherWt, producedMt],
  );
  const packedMm = useMemo(
    () => lines.reduce((s, l) => s + (l.targetWidthMm ?? 0), 0),
    [lines],
  );
  const widthWarn = motherWidth > 0 && packedMm > motherWidth * 1.02;
  const massWarn = crsMassBalanceWarn(
    motherWt,
    lines.map((l) => l.actualWeightMt ?? 0),
    scrapMt,
    0,
  );

  function addLine() {
    if (lines.length >= MAX_SLOTS) return;
    const slot = nextSlot(lines.map((l) => l.slot));
    setLines([...lines, {
      slot,
      childCoilNo: `${coilNo}-${slot}`,
      plannedThkMm: Number(prefill.thicknessMm ?? 0) || undefined,
      taper: '',
      customer: '',
      sapBatchNumber: coilNo,
      surfaceFinish: '',
      routeRaw: '',
      downstreamCrsCombination: '',
      holdFlag: false,
      forCtlFlag: false,
    }]);
  }

  function patch(slot: string, p: Partial<HrsLine>) {
    setLines(lines.map((l) => {
      if (l.slot !== slot) return l;
      const next = { ...l, ...p, childCoilNo: `${coilNo}-${slot}` };
      if (p.routeRaw != null) {
        const f = flagsFromRoute(next.routeRaw);
        if (p.holdFlag == null) next.holdFlag = f.holdFlag;
        if (p.forCtlFlag == null) next.forCtlFlag = f.forCtlFlag;
      }
      return next;
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.length === 0) {
      setError('Add at least one slit line');
      return;
    }
    const missingRoute = lines.find((l) => !l.holdFlag && !l.routeRaw.trim());
    if (missingRoute) {
      setError(`Route required for slit ${missingRoute.slot} (hard gate — child journey spawn)`);
      return;
    }
    setSubmitting(true);
    try {
      await submitProcessCapture('/production/hrs', {
        machineCode,
        shiftLogId,
        coilNo,
        nominalWidthMm: motherWidth,
        actualWidthMm: actualMotherWidth,
        nominalThkMm: Number(prefill.thicknessMm ?? 0),
        motherCoilWeightMt: motherWt,
        weightMt: producedMt,
        scrapMt,
        scrapPct,
        gradeCode: prefill.gradeCode ? String(prefill.gradeCode) : undefined,
        specVersionId,
        slitSlots: lines.map((l) => ({
          slot: l.slot,
          widthMm: l.targetWidthMm,
          targetWidthMm: l.targetWidthMm,
          actualWidthMm: l.actualWidthMm,
          plannedThkMm: l.plannedThkMm,
          thkIdMm: l.thkIdMm,
          thkCentreMm: l.thkCentreMm,
          thkOdMm: l.thkOdMm,
          plannedWeightMt: l.plannedWeightMt,
          actualWeightMt: l.actualWeightMt,
          taper: l.taper || undefined,
          childCoilNo: l.childCoilNo,
          customer: l.customer || undefined,
          sapBatchNumber: l.sapBatchNumber || undefined,
          surfaceFinish: l.surfaceFinish || undefined,
          finishThicknessMm: l.finishThicknessMm,
          routeRaw: l.routeRaw,
          downstreamCrsCombination: l.downstreamCrsCombination || undefined,
          holdFlag: l.holdFlag,
          forCtlFlag: l.forCtlFlag,
        })),
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
        <ReadOnly label="Grade" value={String(prefill.gradeCode ?? '—')} />
        <ZInput label="RM Width mm" type="number" value={motherWidth || ''} onChange={(e) => setMotherWidth(Number(e.target.value))} />
        <ZInput label="Actual Mother Width mm" type="number" value={actualMotherWidth || ''} onChange={(e) => setActualMotherWidth(Number(e.target.value))} />
        <ZInput label="M. Coil Weight MT" type="number" value={motherWt || ''} onChange={(e) => setMotherWt(Number(e.target.value))} />
        <ReadOnly label="Produced MT (Σ lines)" value={producedMt.toFixed(3)} />
        <ZInput label="Scrap MT" type="number" value={scrapMt || ''} onChange={(e) => setScrapMt(Number(e.target.value))} />
        <ReadOnly label="Scrap %" value={scrapPct.toFixed(2)} />
      </div>

      <div className="flex gap-2 items-center">
        <ZButton type="button" variant="secondary" onClick={addLine} disabled={lines.length >= MAX_SLOTS}>
          + Slit line
        </ZButton>
        <span className="text-xs text-muted-foreground">Packed {packedMm.toFixed(1)} / {motherWidth || '—'} mm · {lines.length} lines</span>
      </div>

      {widthWarn && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Width combination warn: Σ target widths exceed mother RM width.
        </p>
      )}
      {massWarn && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mass-balance warn: Σ line weight + scrap ≠ mother coil weight.
        </p>
      )}

      {lines.map((line) => (
        <div key={line.slot} className="border rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <ReadOnly label="Slot" value={line.slot} />
            <ReadOnly label="Child Coil" value={line.childCoilNo} />
            <ReadOnly label="Target Width" value={line.targetWidthMm ?? '—'} />
            <ZInput label="Actual Width mm" type="number" value={line.actualWidthMm ?? ''} onChange={(e) => patch(line.slot, { actualWidthMm: Number(e.target.value) })} />
            <ReadOnly label="Planned Wt" value={line.plannedWeightMt ?? '—'} />
            <ZInput label="Actual Weight MT" type="number" value={line.actualWeightMt ?? ''} onChange={(e) => patch(line.slot, { actualWeightMt: Number(e.target.value) })} />
            <ReadOnly label="Planned Thk" value={line.plannedThkMm ?? '—'} />
            <ZInput label="Thk ID mm" type="number" value={line.thkIdMm ?? ''} onChange={(e) => patch(line.slot, { thkIdMm: Number(e.target.value) })} />
            <ZInput label="Thk Centre mm" type="number" value={line.thkCentreMm ?? ''} onChange={(e) => patch(line.slot, { thkCentreMm: Number(e.target.value) })} />
            <ZInput label="Thk OD mm" type="number" value={line.thkOdMm ?? ''} onChange={(e) => patch(line.slot, { thkOdMm: Number(e.target.value) })} />
            <ZInput label="Taper" value={line.taper} onChange={(e) => patch(line.slot, { taper: e.target.value })} />
            <ZInput label="Customer" value={line.customer} onChange={(e) => patch(line.slot, { customer: e.target.value })} />
            <ZInput label="Route (required)" value={line.routeRaw} onChange={(e) => patch(line.slot, { routeRaw: e.target.value })} />
            <ZInput label="SAP Batch" value={line.sapBatchNumber} onChange={(e) => patch(line.slot, { sapBatchNumber: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={line.holdFlag} onChange={(e) => patch(line.slot, { holdFlag: e.target.checked })} />
              HOLD
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={line.forCtlFlag} onChange={(e) => patch(line.slot, { forCtlFlag: e.target.checked })} />
              For-CTL
            </label>
          </div>
        </div>
      ))}

      {error && <p className="text-destructive text-sm">{error}</p>}
      <ZButton type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit HRS'}</ZButton>
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
