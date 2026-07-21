import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';

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
  machines?: string[];
}

interface ShiftReviewData {
  shiftLogId: string;
  prodDate: string;
  shiftCode: string;
  processLine?: string;
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
  onCompleted,
}: {
  shiftLogId: string;
  onCompleted: () => void;
}) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = async () => {
    const trimmed = remarks.trim();
    if (!trimmed) {
      setError('Remarks are required to mark this shift completed.');
      return;
    }
    const confirmed = window.confirm(
      'Mark this shift as completed? It will move to the completed archive for this production day.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await apiClient.put(`/shift-logs/${shiftLogId}/complete`, { remarks: trimmed });
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
        Mark shift completed
      </h4>
      <p className="text-xs text-muted-foreground">
        Closes this active shift log (DRAFT → SUBMITTED). Add closure notes for the archive.
      </p>
      <textarea
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Shift closure remarks (handover notes, open items, production summary…)"
        rows={3}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm resize-y min-h-[4.5rem]"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ZButton variant="accent" onClick={() => void handleComplete()} disabled={busy}>
        {busy ? 'Completing…' : 'Mark completed'}
      </ZButton>
    </div>
  );
}

function ShiftReviewPanel({ review }: { review: ShiftReviewData }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Shift Overview</h4>
        <p className="text-xs text-muted-foreground mb-2">
          {review.prodDate} · Shift {review.shiftCode}
          {review.processLine ? ` · ${review.processLine}` : ''}
          {review.machines.length > 0 ? ` · ${review.machines.join(', ')}` : ''}
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
  return a.processLine.localeCompare(b.processLine);
}

export function PlantShiftReviewPage() {
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, ShiftReviewData>>({});
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Default to plant "today" so active shift data for the current day is front-and-center.
  const [filterDate, setFilterDate] = useState(currentPlantDate);
  const [filterShift, setFilterShift] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('ALL');

  const machineAccess = useAuthStore((s) => s.machineAccess);
  const role = useAuthStore((s) => s.role);

  const machineOptions = useMemo(() => {
    if (role === 'MACHINE_HEAD') return machineAccess;
    const all = new Set<string>();
    for (const log of logs) {
      for (const m of log.machines ?? []) all.add(m);
    }
    return [...all].sort();
  }, [logs, machineAccess, role]);

  const logsByDay = useMemo(() => {
    const map = new Map<string, ShiftLogRow[]>();
    for (const log of logs) {
      const day = String(log.shiftDate).slice(0, 10);
      const bucket = map.get(day) ?? [];
      bucket.push(log);
      map.set(day, bucket);
    }
    for (const [, dayLogs] of map) {
      dayLogs.sort(sortLogsForDay);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  const toggleReview = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setReviewError(null);
    if (reviewById[id]) return;
    setReviewLoadingId(id);
    try {
      const data = await apiClient.get<ShiftReviewData>(`/shift-logs/${id}/review`);
      setReviewById((prev) => ({ ...prev, [id]: data }));
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
          if (!log.machines || log.machines.length === 0) return false;
          return log.machines.some((m) => machineAccess.includes(m));
        });
      }

      if (filterMachine) {
        filtered = filtered.filter((log) => log.machines?.includes(filterMachine));
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
      subtitle="Active and completed shifts by production day — open a row for production summary"
    >
      <div className="flex flex-col gap-6 max-w-5xl">
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

        {!loading && logs.length === 0 && (
          <div className="rounded-2xl border border-border bg-white px-6 py-12 flex flex-col items-center justify-center text-center">
            <ClipboardList className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-foreground">No shifts found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try another date, or switch status to include active DRAFT logs.
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
                  {dayLogs.map((log) => (
                    <li
                      key={log.id}
                      className={`rounded-2xl border bg-white p-5 shadow-sm ${
                        isActiveState(log.state) ? 'border-amber-500/40' : 'border-border'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void toggleReview(log.id)}
                        className="w-full text-left"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono font-bold text-foreground flex items-center gap-1.5">
                              {expandedId === log.id
                                ? <ChevronDown className="w-4 h-4" />
                                : <ChevronRight className="w-4 h-4" />}
                              {log.processLine} · Shift {log.shiftCode}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {isActiveState(log.state)
                                ? `Open · ${log.submittedBy}`
                                : `Submitted by ${log.submittedBy}`}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {log.submittedAt ? formatPlantDateTime(log.submittedAt) : 'Not submitted yet'}
                              {' · '}{log.entryCount} entries
                              {log.overrideCount > 0 ? ` · ${log.overrideCount} overrides` : ''}
                              {log.machines?.length ? ` · ${log.machines.join(', ')}` : ''}
                            </p>
                          </div>
                          <StateBadge state={log.state} />
                        </div>
                      </button>

                      {expandedId === log.id && (
                        <div className="mt-3 rounded-xl border border-border bg-muted/10 p-4">
                          {reviewLoadingId === log.id ? (
                            <p className="text-sm text-muted-foreground">Loading shift summary…</p>
                          ) : reviewError ? (
                            <p className="text-sm text-destructive">{reviewError}</p>
                          ) : reviewById[log.id] ? (
                            <>
                              <ShiftReviewPanel review={reviewById[log.id]} />
                              {isActiveState(log.state) && (
                                <ShiftCompleteForm
                                  shiftLogId={log.id}
                                  onCompleted={() => {
                                    setExpandedId(null);
                                    setReviewById((prev) => {
                                      const next = { ...prev };
                                      delete next[log.id];
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
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </MachineHeadShell>
  );
}
