import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { calculateScrapPct, crsMassBalanceWarn, formatPlantTime } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { submitProcessCapture } from '../../../store/processStore';
import { apiClient } from '../../../lib/apiClient';
import type { BodyProps } from '../../../lib/processConfig';
import { deltaBand } from '../ProcessPairedField';

// ponytail: UI cap 12; model is unbounded
const MAX_SLOTS = 12;
// ponytail: static defaults when quality fetch is NOT_EVALUATED
const DEFAULT_WIDTH_TOL_MM = 0.5;
const DEFAULT_THK_TOL_MM = 0.05;

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

type ThkReading = { time: string; thkMm: number };
type TaperReading = { time: string; taper: string };
type WidthReading = { time: string; widthMm: number };

interface HrsLine {
  slot: string;
  childCoilNo: string;
  targetWidthMm?: number;
  plannedThkMm?: number;
  plannedWeightMt?: number;
  thicknessReadings: ThkReading[];
  taperReadings: TaperReading[];
  customer: string;
  sapBatchNumber: string;
  surfaceFinish: string;
  finishThicknessMm?: number;
  routeRaw: string;
  downstreamCrsCombination: string;
  holdFlag: boolean;
  forCtlFlag: boolean;
}

function flagsFromRoute(routeRaw: string, toWorkCenter?: string) {
  const r = routeRaw.toUpperCase().replace(/\s+/g, '');
  const hold = r === 'SZ' || toWorkCenter === 'Z' || r.includes('HOLD');
  const forCtl = r.includes('CLE');
  return { holdFlag: hold, forCtlFlag: forCtl && !hold };
}

function latestByTime<T extends { time: string }>(readings: T[]): T | undefined {
  if (!readings.length) return undefined;
  return [...readings].sort((a, b) => a.time.localeCompare(b.time)).at(-1);
}

function sortReadings<T extends { time: string }>(readings: T[]): T[] {
  return [...readings].sort((a, b) => a.time.localeCompare(b.time));
}

export function HrsSlitBuilder({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const motherWidth = Number(prefill.widthMm ?? 0);
  const motherWt = Number(prefill.weightMt ?? 0);
  const rmThk = Number(prefill.thicknessMm ?? 0);
  const [widthReadings, setWidthReadings] = useState<WidthReading[]>([]);
  const [scrapMt, setScrapMt] = useState(0);
  const [lines, setLines] = useState<HrsLine[]>([]);
  const [specVersionId, setSpecVersionId] = useState<number | undefined>();
  const [widthTol, setWidthTol] = useState(DEFAULT_WIDTH_TOL_MM);
  const [thkTol, setThkTol] = useState(DEFAULT_THK_TOL_MM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!coilNo) return;
    let cancelled = false;
    const q = new URLSearchParams({ process: 'HRS', by: 'coil', coilNo, mode: 'snapshot' });
    type SpecRow = { code: string; min?: number | null; max?: number | null; tolerance?: number | null; versionId: number };
    void apiClient
      .get<SpecRow[]>(`/quality/fetch?${q}`)
      .then((rows) => {
        if (cancelled || !rows?.length) return;
        setSpecVersionId(rows[0]?.versionId);
        const fin = rows.find((r) => r.code === 'FIN_WIDTH_TOL' || r.code === 'FIN_WIDTH');
        if (fin?.max != null && fin?.min != null) setWidthTol(Math.abs(Number(fin.max) - Number(fin.min)) / 2);
        else if (fin?.tolerance != null) setWidthTol(Number(fin.tolerance));
        const thk = rows.find((r) => r.code === 'FIN_THK_TOL' || r.code === 'FIN_THK' || r.code === 'THK_TOL');
        if (thk?.max != null && thk?.min != null) setThkTol(Math.abs(Number(thk.max) - Number(thk.min)) / 2);
        else if (thk?.tolerance != null) setThkTol(Number(thk.tolerance));
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
        plannedThkMm: ol.thicknessMm ?? (rmThk || undefined),
        plannedWeightMt: ol.weightMt,
        thicknessReadings: [],
        taperReadings: [],
        customer: ol.customerName ?? '',
        sapBatchNumber: ol.batchNumber ?? coilNo,
        surfaceFinish: ol.surfaceFinish ?? '',
        finishThicknessMm: ol.finishThicknessMm,
        routeRaw: ol.routeRaw ?? '',
        downstreamCrsCombination: '',
        ...flags,
      };
    }));
  }, [coilNo, prefill, lines.length, rmThk]);

  const customers = useMemo(() => {
    const set = new Set(lines.map((l) => l.customer.trim()).filter(Boolean));
    return [...set];
  }, [lines]);

  const latestMotherWidth = latestByTime(widthReadings)?.widthMm;
  const producedMt = useMemo(
    () => lines.reduce((s, l) => s + (l.plannedWeightMt ?? 0), 0),
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
    lines.map((l) => l.plannedWeightMt ?? 0),
    scrapMt,
    0,
  );
  const motherWidthCue = deltaBand(latestMotherWidth, motherWidth, widthTol);

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
      setError('No plan slits for this mother — PPC batch required');
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
        nominalWidthMm: motherWidth || undefined,
        actualWidthMm: latestMotherWidth,
        motherWidthReadings: widthReadings,
        nominalThkMm: rmThk || undefined,
        motherCoilWeightMt: motherWt || undefined,
        weightMt: producedMt || undefined,
        scrapMt,
        scrapPct,
        gradeCode: prefill.gradeCode ? String(prefill.gradeCode) : undefined,
        specVersionId,
        slitSlots: lines.map((l) => {
          const thkLatest = latestByTime(l.thicknessReadings)?.thkMm;
          const taperLatest = latestByTime(l.taperReadings)?.taper;
          return {
            slot: l.slot,
            widthMm: l.targetWidthMm,
            targetWidthMm: l.targetWidthMm,
            plannedThkMm: l.plannedThkMm,
            plannedWeightMt: l.plannedWeightMt,
            thicknessReadings: l.thicknessReadings,
            taperReadings: l.taperReadings,
            thkLatestMm: thkLatest,
            taperLatest,
            childCoilNo: l.childCoilNo,
            customer: l.customer || undefined,
            sapBatchNumber: l.sapBatchNumber || undefined,
            surfaceFinish: l.surfaceFinish || undefined,
            finishThicknessMm: l.finishThicknessMm,
            routeRaw: l.routeRaw,
            downstreamCrsCombination: l.downstreamCrsCombination || undefined,
            holdFlag: l.holdFlag,
            forCtlFlag: l.forCtlFlag,
          };
        }),
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
        <ReadOnly label="RM Width mm (plan)" value={motherWidth || '—'} />
        <ReadOnly label="RM Thickness mm" value={rmThk || '—'} />
        <ReadOnly label="M. Coil Weight MT" value={motherWt || '—'} />
        <ReadOnly
          label="Customer(s)"
          value={customers.length ? customers.join(' · ') : '—'}
        />
        <ReadOnly label="Produced MT (Σ plan)" value={producedMt.toFixed(3)} />
        <ReadOnly label="Scrap %" value={scrapPct.toFixed(2)} />
        <ZInput label="Scrap MT" type="number" value={scrapMt || ''} onChange={(e) => setScrapMt(Number(e.target.value))} />
      </div>

      <ReadingSection
        title="Actual Mother Width"
        planLabel={`Plan ${motherWidth || '—'} mm`}
        latestLabel={latestMotherWidth != null ? `${latestMotherWidth} mm` : '—'}
        latestCue={motherWidthCue}
        onAdd={() => setWidthReadings([...widthReadings, { time: formatPlantTime(), widthMm: motherWidth || 0 }])}
        addLabel="Add width reading"
      >
        {sortReadings(widthReadings).map((r, idx) => {
          const i = widthReadings.indexOf(r);
          return (
            <div key={`${r.time}-${idx}`} className="grid grid-cols-[5.5rem_1fr_auto] gap-2 items-end">
              <ZInput
                label="Time"
                value={r.time}
                onChange={(e) => {
                  const next = [...widthReadings];
                  next[i] = { ...r, time: e.target.value };
                  setWidthReadings(next);
                }}
              />
              <ZInput
                label="Width mm"
                type="number"
                value={r.widthMm || ''}
                onChange={(e) => {
                  const next = [...widthReadings];
                  next[i] = { ...r, widthMm: Number(e.target.value) };
                  setWidthReadings(next);
                }}
              />
              <ZButton type="button" variant="secondary" size="sm" onClick={() => setWidthReadings(widthReadings.filter((_, j) => j !== i))}>
                Remove
              </ZButton>
            </div>
          );
        })}
      </ReadingSection>

      <p className="text-xs text-muted-foreground font-mono">
        Packed {packedMm.toFixed(1)} / {motherWidth || '—'} mm · {lines.length} slits
      </p>

      {lines.length === 0 && (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No plan slits for this mother — pick a mother with PPC batch lines.
        </p>
      )}
      {widthWarn && (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Width combination warn: Σ target widths exceed mother RM width.
        </p>
      )}
      {massWarn && (
        <p className="text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Mass-balance warn: Σ plan line weight + scrap ≠ mother coil weight.
        </p>
      )}

      {lines.map((line) => {
        const thkLatest = latestByTime(line.thicknessReadings)?.thkMm;
        const taperLatest = latestByTime(line.taperReadings)?.taper;
        const thkCue = deltaBand(thkLatest, line.plannedThkMm, thkTol);
        return (
          <div key={line.slot} className="border border-border rounded-lg p-4 space-y-3 bg-card">
            <div className="grid grid-cols-2 gap-2">
              <ReadOnly label="Slot" value={line.slot} />
              <ReadOnly label="Child Coil" value={line.childCoilNo} />
              <ReadOnly label="Slit Width mm" value={line.targetWidthMm ?? '—'} />
              <ReadOnly label="Planned Wt MT" value={line.plannedWeightMt ?? '—'} />
              <ReadOnly label="Customer" value={line.customer || '—'} />
              <ReadOnly label="Route" value={line.routeRaw || '—'} />
              <ReadOnly label="SAP Batch" value={line.sapBatchNumber || '—'} />
              <ReadOnly label="Finish Thk mm" value={line.finishThicknessMm ?? '—'} />
              {line.surfaceFinish ? <ReadOnly label="Surface Finish" value={line.surfaceFinish} /> : null}
              <ReadOnly label="Planned Thk mm" value={line.plannedThkMm ?? '—'} />
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input type="checkbox" checked={line.holdFlag} onChange={(e) => patch(line.slot, { holdFlag: e.target.checked })} />
                <span className="uppercase tracking-wide text-accent-foreground bg-accent/80 px-2 py-0.5 rounded text-xs font-semibold">HOLD</span>
              </label>
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input type="checkbox" checked={line.forCtlFlag} onChange={(e) => patch(line.slot, { forCtlFlag: e.target.checked })} />
                For-CTL
              </label>
            </div>

            <ReadingSection
              title="Thickness"
              planLabel={`Plan ${line.plannedThkMm ?? '—'} mm`}
              latestLabel={thkLatest != null ? `${thkLatest} mm` : '—'}
              latestCue={thkCue}
              onAdd={() => patch(line.slot, {
                thicknessReadings: [...line.thicknessReadings, { time: formatPlantTime(), thkMm: line.plannedThkMm ?? 0 }],
              })}
              addLabel="Add thickness reading"
            >
              {sortReadings(line.thicknessReadings).map((r, idx) => {
                const i = line.thicknessReadings.indexOf(r);
                return (
                  <div key={`${r.time}-${idx}`} className="grid grid-cols-[5.5rem_1fr_auto] gap-2 items-end">
                    <ZInput
                      label="Time"
                      value={r.time}
                      onChange={(e) => {
                        const next = [...line.thicknessReadings];
                        next[i] = { ...r, time: e.target.value };
                        patch(line.slot, { thicknessReadings: next });
                      }}
                    />
                    <ZInput
                      label="Thk mm"
                      type="number"
                      value={r.thkMm || ''}
                      onChange={(e) => {
                        const next = [...line.thicknessReadings];
                        next[i] = { ...r, thkMm: Number(e.target.value) };
                        patch(line.slot, { thicknessReadings: next });
                      }}
                    />
                    <ZButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => patch(line.slot, { thicknessReadings: line.thicknessReadings.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </ZButton>
                  </div>
                );
              })}
            </ReadingSection>

            <ReadingSection
              title="Taper"
              planLabel="—"
              latestLabel={taperLatest ?? '—'}
              onAdd={() => patch(line.slot, {
                taperReadings: [...line.taperReadings, { time: formatPlantTime(), taper: '' }],
              })}
              addLabel="Add taper reading"
            >
              {sortReadings(line.taperReadings).map((r, idx) => {
                const i = line.taperReadings.indexOf(r);
                return (
                  <div key={`${r.time}-${idx}`} className="grid grid-cols-[5.5rem_1fr_auto] gap-2 items-end">
                    <ZInput
                      label="Time"
                      value={r.time}
                      onChange={(e) => {
                        const next = [...line.taperReadings];
                        next[i] = { ...r, time: e.target.value };
                        patch(line.slot, { taperReadings: next });
                      }}
                    />
                    <ZInput
                      label="Taper"
                      value={r.taper}
                      onChange={(e) => {
                        const next = [...line.taperReadings];
                        next[i] = { ...r, taper: e.target.value };
                        patch(line.slot, { taperReadings: next });
                      }}
                    />
                    <ZButton
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => patch(line.slot, { taperReadings: line.taperReadings.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </ZButton>
                  </div>
                );
              })}
            </ReadingSection>
          </div>
        );
      })}

      {error && <p className="text-destructive text-sm">{error}</p>}
      <ZButton type="submit" variant="primary" disabled={submitting}>
        {submitting ? 'Submitting…' : 'Save Production Data'}
      </ZButton>
    </form>
  );
}

function ReadingSection({
  title,
  planLabel,
  latestLabel,
  latestCue,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  planLabel: string;
  latestLabel: string;
  latestCue?: { band: string; label: string };
  onAdd: () => void;
  addLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{planLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest</p>
          <p className="font-mono font-semibold text-foreground">
            {latestLabel}
            {latestCue && latestCue.label !== '—' && (
              <span className={`ml-2 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                latestCue.band === 'ok' ? 'text-success bg-success/10 border-success/30'
                  : latestCue.band === 'warn' ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-muted-foreground bg-muted/40 border-border/50'
              }`}>Δ {latestCue.label}</span>
            )}
          </p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
      <ZButton type="button" variant="secondary" onClick={onAdd}>{addLabel}</ZButton>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-secondary/40 rounded-lg px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono font-semibold">{value}</p>
    </div>
  );
}
