import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { calculateScrapPct, formatPlantTime } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { submitProcessCapture } from '../../../store/processStore';
import { apiClient } from '../../../lib/apiClient';
import type { BodyProps } from '../../../lib/processConfig';
import { deltaBand } from '../ProcessPairedField';
import {
  cleanTaperReadings,
  latestByTime,
  parseDecimalInput,
  sanitizeDecimalInput,
  slotReadingsToThkPasses,
  thkPassesToSlotReadings,
  type ThkPass,
} from '../../../lib/hrsThkMatrix';
import { useProcessStore } from '../../../store/processStore';

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

type TaperReading = { time: string; taper: string };
type WidthReading = { time: string; widthMm: string };

type HrsCaptureSlot = {
  slot: string;
  targetWidthMm?: number;
  plannedThkMm?: number;
  plannedWeightMt?: number;
  childCoilNo?: string;
  customer?: string;
  sapBatchNumber?: string;
  surfaceFinish?: string;
  finishThicknessMm?: number;
  routeRaw?: string;
  downstreamCrsCombination?: string;
  holdFlag?: boolean;
  forCtlFlag?: boolean;
  thicknessReadings?: { time: string; thkMm: number }[];
  taperReadings?: { time: string; taper: string }[];
};

type HrsCapture = {
  motherWidthReadings?: { time: string; widthMm: number }[];
  slitSlots?: HrsCaptureSlot[];
};

interface HrsLine {
  slot: string;
  childCoilNo: string;
  targetWidthMm?: number;
  plannedThkMm?: number;
  plannedWeightMt?: number;
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

function positiveOrUndef(n: number | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n > 0 ? n : undefined;
}

function fieldNum(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const n = Number((raw as { value: unknown }).value);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function emptyThkPass(): ThkPass {
  return { time: formatPlantTime(), bySlot: {} };
}

export function HrsSlitBuilder({ coilNo, prefill, shiftLogId, machineCode, onSubmitted }: BodyProps) {
  const motherWidth = fieldNum(prefill.widthMm);
  const motherWt = fieldNum(prefill.weightMt);
  const rmThk = fieldNum(prefill.thicknessMm);
  const orderLines = (prefill as { orderLines?: OrderLine[] }).orderLines;
  const hrsCapture = (prefill as { hrsCapture?: HrsCapture | null }).hrsCapture;
  const orderLinesKey = Array.isArray(orderLines)
    ? orderLines.map((ol) => `${ol.slitId ?? ''}:${ol.widthMm ?? ''}:${ol.weightMt ?? ''}`).join('|')
    : '';
  const captureKey = hrsCapture
    ? `${hrsCapture.motherWidthReadings?.length ?? 0}:${hrsCapture.slitSlots?.map((s) => s.slot).join(',') ?? ''}`
    : '';
  const isCompleted = useProcessStore((s) =>
    s.queue.find((c) => c.coilNo === coilNo)?.status === 'COMPLETED',
  );
  const [widthReadings, setWidthReadings] = useState<WidthReading[]>(() => [
    { time: formatPlantTime(), widthMm: '' },
  ]);
  const [taperReadings, setTaperReadings] = useState<TaperReading[]>(() => [
    { time: formatPlantTime(), taper: '' },
  ]);
  const [thkPasses, setThkPasses] = useState<ThkPass[]>([emptyThkPass()]);
  const [lines, setLines] = useState<HrsLine[]>([]);
  const [specVersionId, setSpecVersionId] = useState<number | undefined>();
  const [widthTol, setWidthTol] = useState(DEFAULT_WIDTH_TOL_MM);
  const [thkTol, setThkTol] = useState(DEFAULT_THK_TOL_MM);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // ponytail: cells buffer their own drafts and lift on blur; this tracks any
  // not-yet-blurred edits so submit can force-flush them (Android Save may not blur first).
  // Keys: `width:{i}`, `taper:{i}`, `thk:{passIndex}:{slot}`.
  const pendingRef = useRef<Map<string, string>>(new Map());

  const commitWidthReading = useCallback((i: number, widthMm: string) => {
    setWidthReadings((prev) => prev.map((r, idx) => (idx === i ? { ...r, widthMm } : r)));
  }, []);
  const commitTaperReading = useCallback((i: number, taper: string) => {
    setTaperReadings((prev) => prev.map((r, idx) => (idx === i ? { ...r, taper } : r)));
  }, []);
  const commitThkCell = useCallback((passIndex: number, slot: string, value: string) => {
    setThkPasses((prev) => prev.map((p, idx) => (
      idx === passIndex ? { ...p, bySlot: { ...p.bySlot, [slot]: value } } : p
    )));
  }, []);

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
    if (orderLines?.length) {
      setLines(orderLines.slice(0, MAX_SLOTS).map((ol, i) => {
        const slot = (ol.slitId?.trim().toUpperCase() || String.fromCharCode(65 + i)).slice(0, 8);
        const flags = flagsFromRoute(ol.routeRaw ?? '', ol.toWorkCenter);
        const saved = hrsCapture?.slitSlots?.find((s) => s.slot.toUpperCase() === slot);
        return {
          slot,
          childCoilNo: saved?.childCoilNo ?? `${coilNo}-${slot}`,
          targetWidthMm: ol.widthMm,
          plannedThkMm: ol.thicknessMm ?? (rmThk || undefined),
          plannedWeightMt: ol.weightMt,
          customer: ol.customerName ?? saved?.customer ?? '',
          sapBatchNumber: ol.batchNumber ?? saved?.sapBatchNumber ?? coilNo,
          surfaceFinish: ol.surfaceFinish ?? saved?.surfaceFinish ?? '',
          finishThicknessMm: ol.finishThicknessMm ?? saved?.finishThicknessMm,
          routeRaw: ol.routeRaw ?? saved?.routeRaw ?? '',
          downstreamCrsCombination: saved?.downstreamCrsCombination ?? '',
          // Prefer saved capture flags so operator HOLD override survives reload
          holdFlag: saved != null ? !!saved.holdFlag : flags.holdFlag,
          forCtlFlag: saved != null ? !!saved.forCtlFlag : flags.forCtlFlag,
        };
      }));
      return;
    }
    if (hrsCapture?.slitSlots?.length) {
      setLines(hrsCapture.slitSlots.slice(0, MAX_SLOTS).map((s) => ({
        slot: s.slot,
        childCoilNo: s.childCoilNo ?? `${coilNo}-${s.slot}`,
        targetWidthMm: s.targetWidthMm,
        plannedThkMm: s.plannedThkMm ?? (rmThk || undefined),
        plannedWeightMt: s.plannedWeightMt,
        customer: s.customer ?? '',
        sapBatchNumber: s.sapBatchNumber ?? coilNo,
        surfaceFinish: s.surfaceFinish ?? '',
        finishThicknessMm: s.finishThicknessMm,
        routeRaw: s.routeRaw ?? '',
        downstreamCrsCombination: s.downstreamCrsCombination ?? '',
        holdFlag: !!s.holdFlag,
        forCtlFlag: !!s.forCtlFlag,
      })));
      return;
    }
    setLines([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable keys derived from orderLines + hrsCapture
  }, [coilNo, orderLinesKey, rmThk, captureKey]);

  useEffect(() => {
    if (!hrsCapture) return;
    if (hrsCapture.motherWidthReadings?.length) {
      setWidthReadings(hrsCapture.motherWidthReadings.map((r) => ({
        time: r.time,
        widthMm: String(r.widthMm),
      })));
    }
    const tapers = (hrsCapture.slitSlots ?? []).flatMap((s) => s.taperReadings ?? []);
    const seen = new Set<string>();
    const uniqueTapers: TaperReading[] = [];
    for (const r of tapers) {
      const key = `${r.time}|${r.taper}`;
      if (!r.time || !r.taper || seen.has(key)) continue;
      seen.add(key);
      uniqueTapers.push({ time: r.time, taper: r.taper });
    }
    if (uniqueTapers.length) setTaperReadings(uniqueTapers);
    const passes = slotReadingsToThkPasses(
      (hrsCapture.slitSlots ?? []).map((s) => ({ slot: s.slot, readings: s.thicknessReadings ?? [] })),
    );
    if (passes.length) setThkPasses(passes);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captureKey tracks hrsCapture identity
  }, [coilNo, captureKey]);

  const latestMotherWidth = latestByTime(
    widthReadings.flatMap((r) => {
      const widthMm = parseDecimalInput(r.widthMm);
      return widthMm != null && r.time.trim() ? [{ time: r.time, widthMm }] : [];
    }),
  )?.widthMm;
  const producedMt = useMemo(
    () => lines.reduce((s, l) => s + (l.plannedWeightMt ?? 0), 0),
    [lines],
  );
  const packedMm = useMemo(
    () => lines.reduce((s, l) => s + (l.targetWidthMm ?? 0), 0),
    [lines],
  );
  const widthWarn = motherWidth > 0 && packedMm > motherWidth * 1.02;
  const motherWidthCue = deltaBand(latestMotherWidth, motherWidth, widthTol);
  const cleanTaper = cleanTaperReadings(taperReadings);
  const latestTaper = latestByTime(cleanTaper)?.taper;

  function buildSlitSlot(l: HrsLine, thkPassesNow: ThkPass[], cleanTaperNow: TaperReading[]) {
    const thicknessReadings = thkPassesToSlotReadings(thkPassesNow, l.slot);
    return {
      slot: l.slot,
      widthMm: positiveOrUndef(l.targetWidthMm),
      targetWidthMm: positiveOrUndef(l.targetWidthMm),
      plannedThkMm: positiveOrUndef(l.plannedThkMm),
      plannedWeightMt: positiveOrUndef(l.plannedWeightMt),
      thicknessReadings: thicknessReadings.length ? thicknessReadings : undefined,
      taperReadings: cleanTaperNow.length ? cleanTaperNow : undefined,
      thkLatestMm: latestByTime(thicknessReadings)?.thkMm,
      taperLatest: latestByTime(cleanTaperNow)?.taper,
      childCoilNo: l.childCoilNo,
      customer: l.customer || undefined,
      sapBatchNumber: l.sapBatchNumber || undefined,
      surfaceFinish: l.surfaceFinish || undefined,
      finishThicknessMm: positiveOrUndef(l.finishThicknessMm),
      routeRaw: l.routeRaw,
      downstreamCrsCombination: l.downstreamCrsCombination || undefined,
      holdFlag: l.holdFlag,
      forCtlFlag: l.forCtlFlag,
    };
  }

  // MANDATORY: force-flush any unblurred cell drafts before reading state
  // (Android Save may not blur the focused input first).
  function flushDrafts() {
    if (pendingRef.current.size === 0) return { widthReadings, taperReadings, thkPasses };
    let nextWidth = widthReadings;
    let nextTaper = taperReadings;
    let nextThk = thkPasses;
    for (const [key, val] of pendingRef.current) {
      const [kind, a, b] = key.split(':');
      if (kind === 'width') {
        const i = Number(a);
        nextWidth = nextWidth.map((r, idx) => (idx === i ? { ...r, widthMm: val } : r));
      } else if (kind === 'taper') {
        const i = Number(a);
        nextTaper = nextTaper.map((r, idx) => (idx === i ? { ...r, taper: val } : r));
      } else if (kind === 'thk') {
        const passIdx = Number(a);
        nextThk = nextThk.map((p, idx) => (
          idx === passIdx ? { ...p, bySlot: { ...p.bySlot, [b]: val } } : p
        ));
      }
    }
    pendingRef.current.clear();
    setWidthReadings(nextWidth);
    setTaperReadings(nextTaper);
    setThkPasses(nextThk);
    return { widthReadings: nextWidth, taperReadings: nextTaper, thkPasses: nextThk };
  }

  async function persist(complete: boolean) {
    if (isCompleted) return;
    const flushed = flushDrafts();
    setError(null);
    setMsg(null);
    if (lines.length === 0) {
      setError('No plan slots for this mother — PPC batch required');
      return;
    }
    const missingRoute = lines.find((l) => !l.holdFlag && !l.routeRaw.trim());
    if (missingRoute) {
      setError(`Route required for slit ${missingRoute.slot} (hard gate — child journey spawn)`);
      return;
    }

    const cleanWidthReadings = flushed.widthReadings
      .map((r) => ({ time: r.time.trim(), widthMm: parseDecimalInput(r.widthMm) }))
      .filter((r): r is { time: string; widthMm: number } => !!r.time && r.widthMm != null);
    const submitMotherWidth = latestByTime(cleanWidthReadings)?.widthMm;
    const cleanTaperNow = cleanTaperReadings(flushed.taperReadings);
    const slitSlots = lines.map((l) => buildSlitSlot(l, flushed.thkPasses, cleanTaperNow));

    setSubmitting(true);
    try {
      if (!shiftLogId) throw new Error('No active shift — open a shift before saving');
      const payload = {
        machineCode,
        shiftLogId: String(shiftLogId),
        coilNo,
        nominalWidthMm: positiveOrUndef(motherWidth),
        actualWidthMm: submitMotherWidth,
        motherWidthReadings: cleanWidthReadings.length ? cleanWidthReadings : undefined,
        nominalThkMm: positiveOrUndef(rmThk),
        motherCoilWeightMt: positiveOrUndef(motherWt),
        weightMt: positiveOrUndef(producedMt),
        scrapMt: 0,
        scrapPct: calculateScrapPct(0, positiveOrUndef(motherWt) ?? 0),
        gradeCode: prefill.gradeCode ? String(prefill.gradeCode) : undefined,
        specVersionId,
        slitSlots,
      };
      if (complete) {
        await submitProcessCapture('/production/hrs', payload, coilNo);
        onSubmitted?.();
      } else {
        await submitProcessCapture('/production/hrs/draft', payload, coilNo);
        setMsg('Production data saved. Order still in progress — use End on the rail to complete.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : complete ? 'Submit failed' : 'Save failed';
      setError(msg);
      if (complete) {
        useProcessStore.setState({ captureError: msg });
        useProcessStore.getState().settleEndCaptureError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveOnly() {
    await persist(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await persist(true);
  }

  return (
    <form onSubmit={handleSubmit} className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <ChipSection
          title="Actual Mother Width"
          planLabel={`Plan ${motherWidth || '—'} mm`}
          latestLabel={latestMotherWidth != null ? `${latestMotherWidth} mm` : '—'}
          latestCue={motherWidthCue}
          onAdd={() => setWidthReadings([...widthReadings, { time: formatPlantTime(), widthMm: motherWidth > 0 ? String(motherWidth) : '' }])}
          addLabel="Add width reading"
        >
          {widthReadings.map((r, i) => (
            <ReadingChip
              key={`${r.time}-${i}`}
              pendingKey={`width:${i}`}
              pendingRef={pendingRef}
              index={i}
              value={r.widthMm}
              time={r.time}
              onCommit={commitWidthReading}
              onRemove={i === widthReadings.length - 1 && widthReadings.length > 1
                ? () => setWidthReadings(widthReadings.slice(0, -1))
                : undefined}
            />
          ))}
        </ChipSection>

        <p className="text-xs text-muted-foreground font-mono">
          Packed {packedMm.toFixed(1)} / {motherWidth || '—'} mm · {lines.length} slots
        </p>

        {lines.length === 0 && (
          <p className="text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
            No plan slots for this mother — pick a mother with PPC batch lines.
          </p>
        )}
        {widthWarn && (
          <p className="text-sm text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
            Width combination warn: Σ target widths exceed mother RM width.
          </p>
        )}

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <div className="flex gap-3 min-w-min">
              {lines.map((line) => (
                <SlotSummaryCard
                  key={line.slot}
                  line={line}
                  disabled={isCompleted}
                  onHoldChange={(hold) => {
                    setLines((prev) => prev.map((l) => (
                      l.slot === line.slot
                        ? { ...l, holdFlag: hold, forCtlFlag: hold ? false : l.forCtlFlag }
                        : l
                    )));
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Thickness</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[16rem] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-wide text-muted-foreground font-medium w-20 pb-1"> </th>
                    {lines.map((line) => {
                      const latest = latestByTime(thkPassesToSlotReadings(thkPasses, line.slot))?.thkMm;
                      return (
                        <SlotThkHeader
                          key={line.slot}
                          slot={line.slot}
                          latestThkMm={latest}
                          plannedThkMm={line.plannedThkMm}
                          thkTol={thkTol}
                        />
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {thkPasses.map((pass, i) => (
                    <tr key={`${pass.time}-${i}`}>
                      <td className="align-top pr-2 py-1 w-24">
                        <div className="flex items-start gap-1">
                          <div>
                            <p className="text-xs leading-tight">{i + 1}</p>
                            <p className="text-[9px] text-muted-foreground leading-tight">{pass.time}</p>
                          </div>
                          {i === thkPasses.length - 1 && thkPasses.length > 1 ? (
                            <DeleteLastButton label="Remove last thickness" onClick={() => setThkPasses(thkPasses.slice(0, -1))} />
                          ) : null}
                        </div>
                      </td>
                      {lines.map((line) => (
                        <td key={line.slot} className="px-1 py-1">
                          <ThkCell
                            passIndex={i}
                            slot={line.slot}
                            value={pass.bySlot[line.slot] ?? ''}
                            pendingRef={pendingRef}
                            onCommit={commitThkCell}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ZButton type="button" variant="secondary" size="sm" onClick={() => setThkPasses([...thkPasses, emptyThkPass()])}>
              Add thickness
            </ZButton>
          </div>
        )}

        <ChipSection
          title="Taper"
          latestLabel={latestTaper ?? '—'}
          onAdd={() => setTaperReadings([...taperReadings, { time: formatPlantTime(), taper: '' }])}
          addLabel="Add taper reading"
        >
          {taperReadings.map((r, i) => (
            <ReadingChip
              key={`${r.time}-${i}`}
              pendingKey={`taper:${i}`}
              pendingRef={pendingRef}
              index={i}
              value={r.taper}
              time={r.time}
              numeric={false}
              onCommit={commitTaperReading}
              onRemove={i === taperReadings.length - 1 && taperReadings.length > 1
                ? () => setTaperReadings(taperReadings.slice(0, -1))
                : undefined}
            />
          ))}
        </ChipSection>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-3 py-2 space-y-1.5">
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
      </div>
    </form>
  );
}

function ChipSection({
  title,
  planLabel,
  latestLabel,
  latestCue,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  planLabel?: string;
  latestLabel: string;
  latestCue?: { band: string; label: string };
  onAdd: () => void;
  addLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
          {planLabel ? <p className="text-xs text-muted-foreground">{planLabel}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm font-semibold text-foreground">
            {latestLabel}
            {latestCue && latestCue.label !== '—' && (
              <span className={`ml-1.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                latestCue.band === 'ok' ? 'text-success bg-success/10 border-success/30'
                  : latestCue.band === 'warn' ? 'text-warning bg-warning/10 border-warning/30'
                    : 'text-muted-foreground bg-muted/40 border-border/50'
              }`}>Δ {latestCue.label}</span>
            )}
          </p>
          <ZButton type="button" variant="secondary" onClick={onAdd}>{addLabel}</ZButton>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

/**
 * A single width/taper reading chip. Owns its own draft while typing so
 * keystrokes never touch parent state; lifts to the parent via `onCommit` on
 * blur. `pendingRef` lets the top-level submit force-flush this draft even if
 * blur never fires (Android Save).
 */
const ReadingChip = memo(function ReadingChip({
  pendingKey,
  pendingRef,
  index,
  value,
  time,
  onCommit,
  onRemove,
  numeric = true,
}: {
  pendingKey: string;
  pendingRef: React.MutableRefObject<Map<string, string>>;
  index: number;
  value: string;
  time: string;
  onCommit: (index: number, raw: string) => void;
  onRemove?: () => void;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="flex items-start gap-1">
      <div className="w-[14rem]">
        <input
          type="text"
          inputMode={numeric ? 'decimal' : 'text'}
          className="h-12 w-full rounded-md border border-input bg-background px-3 text-base font-mono tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          value={draft}
          onChange={(e) => {
            const raw = numeric ? sanitizeDecimalInput(e.target.value) : e.target.value;
            setDraft(raw);
            pendingRef.current.set(pendingKey, raw);
          }}
          onBlur={() => {
            pendingRef.current.delete(pendingKey);
            if (draft !== value) onCommit(index, draft);
          }}
        />
        <p className="text-[11px] text-muted-foreground text-center leading-tight mt-1 tabular-nums">{time}</p>
      </div>
      {onRemove ? <DeleteLastButton label="Remove last reading" onClick={onRemove} /> : null}
    </div>
  );
});

function DeleteLastButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ZButton type="button" variant="ghost" size="sm" aria-label={label} onClick={onClick} className="px-2 shrink-0">
      <Trash2 className="h-4 w-4 text-destructive" />
    </ZButton>
  );
}

function SlotCell({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold truncate">{value}</p>
    </div>
  );
}

/** Slot summary + HOLD toggle. Memoized so width/taper/thickness edits elsewhere skip re-render. */
const SlotSummaryCard = memo(function SlotSummaryCard({
  line,
  disabled,
  onHoldChange,
}: {
  line: HrsLine;
  disabled?: boolean;
  onHoldChange: (hold: boolean) => void;
}) {
  return (
    <div className="min-w-[17rem] flex-1 border border-border rounded-lg px-3 py-2.5 bg-secondary/30">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-mono font-bold text-lg leading-none">{line.slot}</p>
          {line.holdFlag ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-destructive shrink-0">HOLD</span>
          ) : null}
        </div>
        <p className="text-xs font-mono text-muted-foreground truncate">{line.childCoilNo}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <SlotCell label="Width mm" value={line.targetWidthMm ?? '—'} />
        <SlotCell label="Wt MT" value={line.plannedWeightMt ?? '—'} />
        <SlotCell label="Plan Thk" value={line.plannedThkMm ?? '—'} />
        <SlotCell label="Finish Thk" value={line.finishThicknessMm ?? '—'} />
        <SlotCell label="Customer" value={line.customer || '—'} wide />
        <SlotCell label="Batch" value={line.sapBatchNumber || '—'} wide />
        {line.surfaceFinish ? <SlotCell label="Surface" value={line.surfaceFinish} wide /> : null}
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={line.holdFlag}
          disabled={disabled}
          onChange={(e) => onHoldChange(e.target.checked)}
        />
        HOLD (no advance)
      </label>
    </div>
  );
});

/** Thickness matrix column header + Δ cue. Memoized on primitive props so unrelated slot edits skip it. */
const SlotThkHeader = memo(function SlotThkHeader({
  slot,
  latestThkMm,
  plannedThkMm,
  thkTol,
}: {
  slot: string;
  latestThkMm: number | undefined;
  plannedThkMm: number | undefined;
  thkTol: number;
}) {
  const cue = deltaBand(latestThkMm, plannedThkMm, thkTol);
  return (
    <th className="text-center font-mono text-sm font-bold pb-1 px-1">
      {slot}
      {cue.label !== '—' && (
        <span className={`block text-[9px] font-mono font-semibold ${
          cue.band === 'ok' ? 'text-success' : cue.band === 'warn' ? 'text-warning' : 'text-muted-foreground'
        }`}>Δ {cue.label}</span>
      )}
    </th>
  );
});

/**
 * One thickness matrix cell. Owns its own draft while typing (no parent
 * setState per keystroke), lifts to `onCommit` on blur. `pendingRef` lets
 * submit force-flush this draft if blur never fires.
 */
const ThkCell = memo(function ThkCell({
  passIndex,
  slot,
  value,
  pendingRef,
  onCommit,
}: {
  passIndex: number;
  slot: string;
  value: string;
  pendingRef: React.MutableRefObject<Map<string, string>>;
  onCommit: (passIndex: number, slot: string, value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const pendingKey = `thk:${passIndex}:${slot}`;

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={`Thickness ${passIndex + 1} slot ${slot}`}
      className="h-9 w-full min-w-[3.5rem] rounded-sm border border-input bg-background px-2 text-sm font-mono tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      value={draft}
      onChange={(e) => {
        const raw = sanitizeDecimalInput(e.target.value);
        setDraft(raw);
        pendingRef.current.set(pendingKey, raw);
      }}
      onBlur={() => {
        pendingRef.current.delete(pendingKey);
        if (draft !== value) onCommit(passIndex, slot, draft);
      }}
    />
  );
});
