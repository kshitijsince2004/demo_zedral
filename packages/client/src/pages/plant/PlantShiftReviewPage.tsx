import { useCallback, useEffect, useState } from 'react';
import { Check, X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { ZButton } from '../../components/primitives/ZButton';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { useAuthStore } from '../../lib/authStore';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';

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

function ReviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-bold font-mono tabular-nums text-foreground mt-0.5">{value}</div>
    </div>
  );
}

export function PlantShiftReviewPage() {
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, ShiftReviewData>>({});
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const machineAccess = useAuthStore((s) => s.machineAccess);
  const role = useAuthStore((s) => s.role);

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
      const rows = await apiClient.get<ShiftLogRow[]>('/shift-logs?state=SUBMITTED');
      
      let filtered = rows;
      if (role === 'MACHINE_HEAD') {
        filtered = rows.filter((log) => {
          if (!log.machines || log.machines.length === 0) return false;
          return log.machines.some((m) => machineAccess.includes(m));
        });
      }
      
      setLogs(filtered);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to load shift logs');
    } finally {
      setLoading(false);
    }
  }, [machineAccess, role]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/approve`, {});
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    if (!rejectNote.trim()) {
      alert('Rejection note is required');
      return;
    }
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/reject`, { note: rejectNote.trim() });
      setRejectingId(null);
      setRejectNote('');
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (id: string) => {
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/reopen`, {});
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Reopen failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <MachineHeadShell title="Shift Review" subtitle="Approve or reject submitted shift logs">
    <div className="flex flex-col gap-6 max-w-5xl">

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-white px-6 py-12 text-sm text-muted-foreground">
          <div className="animate-spin mr-2 h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          Loading pending reviews…
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="rounded-2xl border border-border bg-white px-6 py-12 flex flex-col items-center justify-center text-center">
          <Check className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-foreground">All caught up</p>
          <p className="text-sm text-muted-foreground mt-1">No shift logs are awaiting your review.</p>
        </div>
      )}

      <ul className="space-y-3">
        {logs.map((log) => (
          <li key={log.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono font-bold text-foreground">
                  {log.processLine} · Shift {log.shiftCode}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {String(log.shiftDate).slice(0, 10)} · Submitted by {log.submittedBy}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {log.submittedAt ? formatPlantDateTime(log.submittedAt) : '—'}
                  {' · '}{log.entryCount} entries
                  {log.overrideCount > 0 ? ` · ${log.overrideCount} overrides` : ''}
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-warning bg-warning/10 px-2 py-1 rounded-lg">
                {log.state}
              </span>
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => void toggleReview(log.id)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                {expandedId === log.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Shift summary
              </button>

              {expandedId === log.id && (
                <div className="mt-3 rounded-xl border border-border bg-muted/10 p-4">
                  {reviewLoadingId === log.id ? (
                    <p className="text-sm text-muted-foreground">Loading shift summary…</p>
                  ) : reviewError ? (
                    <p className="text-sm text-destructive">{reviewError}</p>
                  ) : reviewById[log.id] ? (
                    <ShiftReviewPanel review={reviewById[log.id]} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No summary available.</p>
                  )}
                </div>
              )}
            </div>

            {rejectingId === log.id ? (
              <div className="mt-4 space-y-2">
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Rejection reason (required)"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm min-h-[80px]"
                />
                <div className="flex gap-2 justify-end">
                  <ZButton variant="outline" size="sm" onClick={() => { setRejectingId(null); setRejectNote(''); }}>
                    Cancel
                  </ZButton>
                  <ZButton variant="danger" size="sm" disabled={busyId === log.id} onClick={() => void reject(log.id)}>
                    Confirm Reject
                  </ZButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-4 justify-end">
                <ZButton
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={busyId === log.id}
                  onClick={() => void reopen(log.id)}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen
                </ZButton>
                <ZButton
                  variant="outline"
                  size="sm"
                  className="gap-1 text-destructive border-destructive/30"
                  disabled={busyId === log.id}
                  onClick={() => setRejectingId(log.id)}
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </ZButton>
                <ZButton
                  variant="primary"
                  size="sm"
                  className="gap-1"
                  disabled={busyId === log.id}
                  onClick={() => void approve(log.id)}
                >
                  <Check className="w-3.5 h-3.5" /> Approve
                </ZButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
    </MachineHeadShell>
  );
}

function formatMinutes(min?: number): string {
  if (min == null || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
