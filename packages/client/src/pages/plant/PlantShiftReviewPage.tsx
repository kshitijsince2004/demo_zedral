import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { putQueued } from '../../lib/sync/queuedApi';
import { currentPlantDate, formatPlantDateTime, formatShiftDate } from '../../lib/dateFormat';
import { bootstrapShiftContext } from '../../lib/shiftDetection';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';

interface ShiftLogRow {
  id: string;
  shiftDate: string;
  shiftCode: string;
  processLine: string;
  submittedBy: string;
  submittedAt: string;
  state: string;
  entryCount: number;
  overrideCount: number;
  millType?: string | null;
  /** Canonical machine for this card (server: one machine · one shift · one card). */
  machine?: string;
  machines?: string[];
  /** When set, this row is a per-machine view of a shared shift log. */
  reviewMachine?: string;
}

interface ShiftReviewData {
  shiftLogId: string;
  prodDate: string;
  shiftCode: string;
  processLine?: string;
  millType?: string | null;
  state: string;
  machines: string[];
  overview: {
    targetMt: number;
    completedProdMt: number;
    totalProdMt: number;
    inProgressProdMt: number;
    attainmentPct: number;
  };
  metrics: {
    totalStoppageMinutes: number;
    totalBreakdownMinutes: number;
    machineUtilizationPct: number;
    shiftCapacityMinutes: number;
  };
  completedOrders: { batchNumber: string; subProcess?: string; customer?: string; weightMt: number; durationMin?: number }[];
  ordersInProgress: { batchNumber: string; status: string; subProcess?: string; machineCode?: string }[];
  stoppages: { id: string; batchNumber: string; categoryLabel: string; startAt: string; endAt?: string; durationMin?: number; remarks?: string }[];
  crew?: { id: string; crewId: string; operatorName: string; roleCode: string }[];
  crewMissing?: boolean;
  autoClosed?: boolean;
  readings?: {
    scrapKg: number | null;
    coolantTempDegC: number | null;
    coolantPressKgCm2: number | null;
  };
  readingsMissing?: {
    scrapKg: boolean;
    coolantTempDegC: boolean;
    coolantPressKgCm2: boolean;
  };
  autoHandover?: {
    handoverId: string;
    remarks: string;
    machineCode: string;
    pendingReview: boolean;
    reviewState?: string;
  } | null;
}

/** In-progress / open shift logs (operators still writing). */
const ACTIVE_STATES = new Set(['DRAFT', 'REOPENED']);
/** Submitted archive (Task 4 completed definition). */
const COMPLETED_STATES = new Set(['SUBMITTED', 'APPROVED']);
const VISIBLE_STATES = new Set([...ACTIVE_STATES, ...COMPLETED_STATES]);

const SHIFT_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED';

function isActiveState(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

function ReviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function formatMinutes(min?: number): string {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StateBadge({ state }: { state: string }) {
  const active = isActiveState(state);
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg ${
        active
          ? 'text-amber-800 bg-amber-500/15'
          : 'text-success bg-success/10'
      }`}
    >
      {active ? `Active · ${state}` : state}
    </span>
  );
}

function ShiftCompleteForm({
  shiftLogId,
  review,
  onCompleted,
}: {
  shiftLogId: string;
  review?: ShiftReviewData;
  onCompleted: () => void;
}) {
  const autoPending = !!(review?.autoClosed && review.autoHandover?.pendingReview);
  const [remarks, setRemarks] = useState(review?.autoHandover?.remarks ?? '');
  const [scrapKg, setScrapKg] = useState(
    review?.readings?.scrapKg != null ? String(review.readings.scrapKg) : '',
  );
  const [coolantTemp, setCoolantTemp] = useState(
    review?.readings?.coolantTempDegC != null ? String(review.readings.coolantTempDegC) : '',
  );
  const [coolantPress, setCoolantPress] = useState(
    review?.readings?.coolantPressKgCm2 != null ? String(review.readings.coolantPressKgCm2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    const trimmed = remarks.trim();
    if (!trimmed) {
      setError('Remarks are required to mark this shift completed.');
      return;
    }
    const confirmed = window.confirm(
      autoPending
        ? 'Sign off this auto-closed shift? Empty coolant/scrap fields will be saved first, then the shift moves to the completed archive.'
        : 'Mark this shift as completed? It will move to the completed archive for this production day.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      if (autoPending) {
        await apiClient.patch(`/shift-logs/${shiftLogId}/manual-fields`, {
          scrapKg: scrapKg.trim() === '' ? null : Number(scrapKg),
          coolantTempDegC: coolantTemp.trim() === '' ? null : Number(coolantTemp),
          coolantPressKgCm2: coolantPress.trim() === '' ? null : Number(coolantPress),
          remarks: trimmed,
        });
      }
      await putQueued(`/shift-logs/${shiftLogId}/complete`, { remarks: trimmed }, `shift-log:${shiftLogId}`);
      onCompleted();
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to complete shift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-border/60 space-y-3">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {autoPending ? 'MH sign-off (auto-closed shift)' : 'Mark shift completed'}
      </h4>
      <p className="text-xs text-muted-foreground">
        {autoPending
          ? 'Backfill any missing coolant/scrap readings from paper notes, then sign off to clear the MH action item.'
          : 'Closes this active shift log (DRAFT → SUBMITTED). Add closure notes for the archive.'}
      </p>
      {autoPending && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Coolant °C</span>
            <input
              type="number"
              step="any"
              value={coolantTemp}
              onChange={(e) => setCoolantTemp(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.coolantTempDegC ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Coolant Kg/cm²</span>
            <input
              type="number"
              step="any"
              value={coolantPress}
              onChange={(e) => setCoolantPress(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.coolantPressKgCm2 ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
          <label className="text-xs space-y-1">
            <span className="font-semibold text-muted-foreground uppercase">Scrap Kg</span>
            <input
              type="number"
              step="any"
              value={scrapKg}
              onChange={(e) => setScrapKg(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm ${
                review?.readingsMissing?.scrapKg ? 'border-warning' : 'border-border'
              } bg-white`}
              placeholder="Missing"
            />
          </label>
        </div>
      )}
      <textarea
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Shift closure remarks (handover notes, open items, production summary…)"
        rows={3}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-y min-h-[4.5rem]"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ZButton variant="accent" onClick={() => void handleComplete()} disabled={busy}>
        {busy ? 'Saving…' : autoPending ? 'Sign off & complete' : 'Mark completed'}
      </ZButton>
    </div>
  );
}

function ShiftReviewPanel({ review }: { review: ShiftReviewData }) {
  return (
    <div className="flex flex-col gap-4">
      {(review.autoClosed || review.crewMissing) && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs space-y-1">
          {review.autoClosed && (
            <p className="font-semibold text-warning-foreground">
              Auto-closed — no operator handover
              {review.autoHandover?.pendingReview ? ' · awaiting MH sign-off' : ''}
            </p>
          )}
          {review.autoHandover?.remarks && (
            <p className="text-muted-foreground">{review.autoHandover.remarks}</p>
          )}
          {review.crewMissing && (
            <p className="text-muted-foreground">Crew not recorded for this shift.</p>
          )}
          {review.autoClosed && review.readingsMissing && (
            <p className="text-muted-foreground">
              Missing readings:
              {[
                review.readingsMissing.coolantTempDegC ? ' coolant °C' : null,
                review.readingsMissing.coolantPressKgCm2 ? ' coolant pressure' : null,
                review.readingsMissing.scrapKg ? ' scrap kg' : null,
              ]
                .filter(Boolean)
                .join(',') || ' none'}
              . Backfill on sign-off.
            </p>
          )}
        </div>
      )}

      {(review.readings || review.autoClosed) && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Shift readings
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <ReviewMetric
              label="Coolant °C"
              value={review.readings?.coolantTempDegC ?? '—'}
            />
            <ReviewMetric
              label="Coolant Kg/cm²"
              value={review.readings?.coolantPressKgCm2 ?? '—'}
            />
            <ReviewMetric label="Scrap Kg" value={review.readings?.scrapKg ?? '—'} />
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Shift Overview</h4>
        <p className="text-xs text-muted-foreground mb-2">
          {formatShiftDate(review.prodDate)} · Shift {review.shiftCode}
          {review.machines.length === 1
            ? ` · ${review.machines[0]}`
            : review.millType
              ? ` · ${review.millType}`
              : review.processLine
                ? ` · ${review.processLine}`
                : ''}
          {review.machines.length > 1 ? ` · ${review.machines.join(', ')}` : ''}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ReviewMetric label="Target MT" value={review.overview.targetMt} />
          <ReviewMetric label="Completed MT" value={review.overview.completedProdMt} />
          <ReviewMetric label="Total MT" value={review.overview.totalProdMt} />
          <ReviewMetric label="In Progress MT" value={review.overview.inProgressProdMt} />
          <ReviewMetric label="Attainment" value={`${review.overview.attainmentPct}%`} />
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Crew this shift ({review.crew?.length ?? 0})
        </h4>
        {review.crew && review.crew.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.crew.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 px-3 py-2 bg-white/40">
                <span className="font-semibold">{c.operatorName}</span>
                <span className="text-muted-foreground uppercase">{c.roleCode}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No crew recorded.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Downtime & Utilization</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <ReviewMetric label="Stoppage" value={formatMinutes(review.metrics.totalStoppageMinutes)} />
          <ReviewMetric label="Breakdown" value={formatMinutes(review.metrics.totalBreakdownMinutes)} />
          <ReviewMetric label="Utilization" value={`${review.metrics.machineUtilizationPct}%`} />
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Completed Orders ({review.completedOrders.length})
        </h4>
        {review.completedOrders.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.completedOrders.map((o) => (
              <li key={o.batchNumber} className="flex justify-between gap-2 px-3 py-2 bg-white/40">
                <span className="font-mono font-semibold">{o.batchNumber}</span>
                <span className="text-muted-foreground truncate flex-1">{o.customer ?? '—'}</span>
                <span className="font-mono">{o.weightMt} MT</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No completed orders.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Orders In Progress ({review.ordersInProgress.length})
        </h4>
        {review.ordersInProgress.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.ordersInProgress.map((o) => (
              <li key={o.batchNumber} className="flex justify-between gap-2 px-3 py-2 bg-white/40">
                <span className="font-mono font-semibold">{o.batchNumber}</span>
                <span className="text-muted-foreground">{o.machineCode ?? '—'}</span>
                <span>{o.status.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No orders in progress.</p>
        )}
      </div>

      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Stoppages ({review.stoppages.length})
        </h4>
        {review.stoppages.length > 0 ? (
          <ul className="divide-y divide-border/60 text-xs rounded-lg border border-border/60 overflow-hidden">
            {review.stoppages.map((s) => (
              <li key={s.id} className="flex justify-between gap-2 px-3 py-2 bg-white/40">
                <span className="font-medium">{s.categoryLabel}</span>
                <span className="text-muted-foreground truncate flex-1">{s.batchNumber}</span>
                <span className="font-mono">{formatMinutes(s.durationMin)}</span>
                <span className={s.endAt ? 'text-muted-foreground' : 'text-destructive font-medium'}>
                  {s.endAt ? 'Ended' : 'Active'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No stoppages recorded.</p>
        )}
      </div>
    </div>
  );
}

function sortLogsForDay(a: ShiftLogRow, b: ShiftLogRow): number {
  const activeDelta = Number(isActiveState(b.state)) - Number(isActiveState(a.state));
  if (activeDelta !== 0) return activeDelta;
  const shiftDelta = (SHIFT_ORDER[a.shiftCode] ?? 9) - (SHIFT_ORDER[b.shiftCode] ?? 9);
  if (shiftDelta !== 0) return shiftDelta;
  const machineA = a.reviewMachine ?? a.millType ?? a.machines?.[0] ?? '';
  const machineB = b.reviewMachine ?? b.millType ?? b.machines?.[0] ?? '';
  const machineDelta = machineA.localeCompare(machineB);
  if (machineDelta !== 0) return machineDelta;
  return a.processLine.localeCompare(b.processLine);
}

/** Normalize API rows to exactly one machine · one shift · one card. */
function expandMachineCards(logs: ShiftLogRow[], allowedMachines?: string[]): ShiftLogRow[] {
  const allow = allowedMachines?.map((m) => m.toUpperCase());
  const out: ShiftLogRow[] = [];

  for (const log of logs) {
    const fromServer = (log.machine || log.millType || '').toUpperCase();
    let machines = fromServer
      ? [fromServer]
      : (log.machines ?? []).map((m) => m.toUpperCase()).filter(Boolean);

    if (allow && allow.length > 0) {
      machines = machines.filter((m) => allow.includes(m));
      if (machines.length === 0) continue;
    }

    if (machines.length === 0) {
      out.push({ ...log, reviewMachine: undefined, machines: [] });
      continue;
    }

    for (const machine of machines) {
      out.push({
        ...log,
        machine,
        reviewMachine: machine,
        machines: [machine],
      });
    }
  }

  // Dedupe: one card per plant-day + shift + machine.
  const byKey = new Map<string, ShiftLogRow>();
  for (const card of out) {
    const day = formatShiftDate(card.shiftDate);
    const machine = card.reviewMachine || card.machine || card.processLine;
    const key = `${day}|${card.shiftCode}|${machine}`;
    const prev = byKey.get(key);
    if (!prev || card.entryCount > prev.entryCount) byKey.set(key, card);
  }
  return [...byKey.values()];
}

function cardKey(log: ShiftLogRow): string {
  const machine = log.reviewMachine || log.machine;
  return machine ? `${log.id}:${machine}` : log.id;
}

function cardTitle(log: ShiftLogRow): string {
  const machine = log.reviewMachine || log.machine || log.millType;
  if (machine) return `${machine} · Shift ${log.shiftCode}`;
  return `${log.processLine} · Shift ${log.shiftCode}`;
}

export function PlantShiftReviewPage() {
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, ShiftReviewData>>({});
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState(() => currentPlantDate());
  const [filterShift, setFilterShift] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('ALL');
  const [currentShiftLabel, setCurrentShiftLabel] = useState<string | null>(null);

  const machineAccess = useOperationalMachineAccess();
  const role = useAuthStore((s) => s.role);
  const shiftBootstrapped = useRef(false);

  useEffect(() => {
    if (shiftBootstrapped.current) return;
    shiftBootstrapped.current = true;
    const machine = machineAccess[0];
    void bootstrapShiftContext(machine)
      .then((shift) => {
        const prodDate = formatShiftDate(shift.prodDate);
        // Pin plant today only — keep "All shifts" so completed A/B still show during C.
        setFilterDate(prodDate);
        setCurrentShiftLabel(`${prodDate} · Shift ${shift.shiftCode}`);
      })
      .catch(() => {
        setCurrentShiftLabel(`${currentPlantDate()} · Shift detection unavailable`);
      });
  }, [machineAccess]);

  const machineOptions = useMemo(() => {
    if (role === 'MACHINE_HEAD') return machineAccess;
    const all = new Set<string>();
    for (const log of logs) {
      if (log.machine) all.add(log.machine);
      for (const m of log.machines ?? []) all.add(m);
      if (log.millType) all.add(log.millType);
    }
    return [...all].sort();
  }, [logs, machineAccess, role]);

  const logsByDay = useMemo(() => {
    const map = new Map<string, ShiftLogRow[]>();
    const allowed = role === 'MACHINE_HEAD' ? machineAccess : undefined;
    for (const log of expandMachineCards(logs, allowed)) {
      if (filterMachine && log.reviewMachine !== filterMachine && !log.machines?.includes(filterMachine)) {
        continue;
      }
      const day = formatShiftDate(log.shiftDate);
      if (day === '—') continue;
      // Hard pin: never show a different plant day than the date filter.
      if (filterDate && day !== filterDate) continue;
      const bucket = map.get(day) ?? [];
      bucket.push(log);
      map.set(day, bucket);
    }
    for (const [, dayLogs] of map) {
      dayLogs.sort(sortLogsForDay);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs, machineAccess, role, filterMachine, filterDate]);

  const toggleReview = useCallback(async (log: ShiftLogRow) => {
    const key = cardKey(log);
    if (expandedId === key) {
      setExpandedId(null);
      return;
    }
    setExpandedId(key);
    setReviewError(null);
    if (reviewById[key]) return;
    setReviewLoadingId(key);
    try {
      const qs = log.reviewMachine
        ? `?machine=${encodeURIComponent(log.reviewMachine)}`
        : '';
      const data = await apiClient.get<ShiftReviewData>(`/shift-logs/${log.id}/review${qs}`);
      setReviewById((prev) => ({ ...prev, [key]: data }));
    } catch (err: unknown) {
      setReviewError((err as Error)?.message ?? 'Failed to load shift summary');
    } finally {
      setReviewLoadingId(null);
    }
  }, [expandedId, reviewById]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (filterDate) qs.set('shiftDate', filterDate);
      if (filterShift) qs.set('shiftCode', filterShift);

      const rows = await apiClient.get<ShiftLogRow[]>(`/shift-logs?${qs.toString()}`);

      let filtered = rows.filter((log) => VISIBLE_STATES.has(log.state));

      if (filterStatus === 'ACTIVE') {
        filtered = filtered.filter((log) => isActiveState(log.state));
      } else if (filterStatus === 'COMPLETED') {
        filtered = filtered.filter((log) => COMPLETED_STATES.has(log.state));
      }

      if (role === 'MACHINE_HEAD') {
        filtered = filtered.filter((log) => {
          const codes = [
            log.machine,
            log.millType,
            ...(log.machines ?? []),
          ]
            .filter(Boolean)
            .map((m) => String(m).toUpperCase());
          if (codes.length === 0) return false;
          return codes.some((m) => machineAccess.includes(m));
        });
      }

      if (filterMachine) {
        filtered = filtered.filter((log) => {
          const code = (log.machine || log.millType || '').toUpperCase();
          if (code === filterMachine) return true;
          return log.machines?.includes(filterMachine);
        });
      }

      setLogs(filtered);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to load shift logs');
    } finally {
      setLoading(false);
    }
  }, [machineAccess, role, filterDate, filterShift, filterMachine, filterStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MachineHeadShell
      title="Shift Review"
      subtitle={
        currentShiftLabel
          ? `Current shift: ${currentShiftLabel} — open a row for production summary and handover details`
          : 'Active and completed shifts by production day — open a row for production summary'
      }
    >
      <div className="flex flex-col gap-6 max-w-5xl">
        {currentShiftLabel && (
          <div className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-foreground">
            <span className="font-semibold">Today&apos;s shift:</span>{' '}
            <span className="font-mono">{currentShiftLabel}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-2xl border border-border bg-white p-4">
          <label className="text-xs font-medium text-muted-foreground">
            Date
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Shift
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All shifts</option>
              {['A', 'B', 'C'].map((s) => (
                <option key={s} value={s}>Shift {s}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Machine
            <select
              value={filterMachine}
              onChange={(e) => setFilterMachine(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All machines</option>
              {machineOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Status
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
              className="mt-1 block w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="ALL">Active + completed</option>
              <option value="ACTIVE">Active only (DRAFT / REOPENED)</option>
              <option value="COMPLETED">Completed only</option>
            </select>
          </label>
        </div>

        {filterDate && (
          <p className="text-xs text-muted-foreground -mt-3">
            Showing plant day <span className="font-mono font-semibold text-foreground">{filterDate}</span>
            {' · '}
            clear the date field to browse all days.
            <button
              type="button"
              className="ml-2 underline underline-offset-2 hover:text-foreground"
              onClick={() => setFilterDate('')}
            >
              Clear date
            </button>
          </p>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center rounded-2xl border border-border bg-white px-6 py-12 text-sm text-muted-foreground">
            <div className="animate-spin mr-2 h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            Loading shifts…
          </div>
        )}

        {!loading && logsByDay.length === 0 && (
          <div className="rounded-2xl border border-border bg-white px-6 py-12 flex flex-col items-center justify-center text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No shifts found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try another date, or switch status to include active DRAFT logs.
              Closed shifts stay Active/DRAFT until a machine head marks them completed.
            </p>
          </div>
        )}

        <div className="space-y-6">
          {logsByDay.map(([day, dayLogs]) => {
            const activeCount = dayLogs.filter((l) => isActiveState(l.state)).length;
            return (
              <section key={day} className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                  <h3 className="text-sm font-bold text-foreground font-mono">{day}</h3>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    {activeCount > 0 ? `${activeCount} active · ` : ''}
                    {dayLogs.length} shift{dayLogs.length === 1 ? '' : 's'}
                  </p>
                </div>
                <ul className="space-y-3">
                  {dayLogs.map((log) => {
                    const key = cardKey(log);
                    return (
                    <li
                      key={key}
                      className={`rounded-2xl border bg-white p-5 shadow-sm ${
                        isActiveState(log.state) ? 'border-amber-500/40' : 'border-border'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void toggleReview(log)}
                        className="w-full text-left"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono font-bold text-foreground flex items-center gap-1.5">
                              {expandedId === key
                                ? <ChevronDown className="w-4 h-4" />
                                : <ChevronRight className="w-4 h-4" />}
                              {cardTitle(log)}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {log.processLine}
                              {' · '}
                              {isActiveState(log.state)
                                ? `Open · ${log.submittedBy}`
                                : `Submitted by ${log.submittedBy}`}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatShiftDate(log.shiftDate)}
                              {' · '}
                              {log.submittedAt ? formatPlantDateTime(log.submittedAt) : 'Not submitted yet'}
                              {' · '}{log.entryCount} entries
                              {log.overrideCount > 0 ? ` · ${log.overrideCount} overrides` : ''}
                            </p>
                          </div>
                          <StateBadge state={log.state} />
                        </div>
                      </button>

                      {expandedId === key && (
                        <div className="mt-3 rounded-xl border border-border bg-muted/10 p-4">
                          {reviewLoadingId === key ? (
                            <p className="text-sm text-muted-foreground">Loading shift summary…</p>
                          ) : reviewError ? (
                            <p className="text-sm text-destructive">{reviewError}</p>
                          ) : reviewById[key] ? (
                            <>
                              <ShiftReviewPanel review={reviewById[key]} />
                              {isActiveState(log.state) && (
                                <ShiftCompleteForm
                                  shiftLogId={log.id}
                                  review={reviewById[key]}
                                  onCompleted={() => {
                                    setExpandedId(null);
                                    setReviewById((prev) => {
                                      const next = { ...prev };
                                      delete next[key];
                                      return next;
                                    });
                                    void load();
                                  }}
                                />
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">No summary available.</p>
                          )}
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </MachineHeadShell>
  );
}
